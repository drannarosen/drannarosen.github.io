#!/usr/bin/env node
/*
 * build-index.mjs — rebuild dist/search.json from the pages actually built.
 *
 * WHY THIS EXISTS: the page half of the index used to be a hand-written array
 * of six entries with hand-typed keyword strings. Papers, astrobytes and
 * packages were derived from content collections and so stayed complete; pages
 * were opt-in, and eighteen of thirty-one were missing — including /now,
 * /group, /about and /software. Nothing failed; search just quietly stopped
 * covering the site.
 *
 * That is the same shape as two other bugs this repo has already had (courses
 * taken by array order, figure captions tracked by hand). The fix is the same:
 * derive the fact, and fail the build when something is neither derived nor
 * deliberately excluded.
 *
 * It runs POSTBUILD over dist/ rather than inside Astro because the built HTML
 * is the only place every page's real text exists — including pages whose
 * content comes from components, data files or MDX bodies. Searching the text
 * a reader actually sees is also the point: the old index could only match
 * keywords somebody remembered to type.
 *
 *   node scripts/search/build-index.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = resolve(ROOT, "dist");
const INDEX = resolve(DIST, "search.json");

if (!existsSync(DIST)) {
  console.error("[search] dist/ not found — run `pnpm build` first.");
  process.exit(1);
}

/*
 * Pages deliberately absent from search, each with a reason. Anything built
 * and not listed here MUST be indexed, so a new page joins search by default
 * rather than by somebody remembering.
 *
 * Redirects are detected automatically and need no entry, and 404.html is not
 * an index.html so the crawler never reaches it.
 */
const EXCLUDED = new Map([
  ["/search", "the search page itself"],
  ["/style-guide", "internal design reference, not content"],
  ["/model-path", "unfinished: one of four stages built, linked from nowhere"],
  ["/cluster-lab", "development sandbox, linked from nowhere"],
  ["/volume-lab", "development sandbox, linked from nowhere"],
  ["/star-render-lab", "Three.js star-rendering sandbox, linked from nowhere"],
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name === "index.html") acc.push(full);
  }
  return acc;
}

const decode = (s) =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

/**
 * The text a reader actually sees.
 *
 * Strips the chrome first — header, footer and the skip link appear on every
 * page, so leaving them in makes every page match "Research Explore
 * Publications…" and ranks nonsense. KaTeX <annotation> holds the original
 * LaTeX; keeping it would let a search for "frac" match every equation.
 */
function pageText(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  return decode(
    main
      .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<annotation[\s\S]*?<\/annotation>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const pages = [];
const problems = [];

for (const file of walk(DIST)) {
  const url = ("/" + relative(DIST, file).replace(/index\.html$/, "")).replace(/\/$/, "") || "/";
  const html = readFileSync(file, "utf8");

  // Old WordPress URLs are preserved as redirects; they are not content.
  if (/http-equiv=["']refresh["']/i.test(html)) continue;

  if (EXCLUDED.has(url)) continue;

  const title = decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").split(" — ")[0];
  const description = decode(
    html.match(/<meta name="description" content="([^"]*)"/i)?.[1] ?? "",
  );
  const text = pageText(html);

  if (!title) {
    problems.push(`${url} has no <title>, so it cannot be indexed.`);
    continue;
  }

  pages.push({
    kind: "page",
    title,
    meta: description,
    // Full text is the point: the old index could only match hand-typed
    // keywords, so "referee", "abstain" or "Bonnor-Ebert" found nothing.
    extra: text,
    url,
    internal: true,
  });
}

/*
 * Collection-backed entries (papers, astrobytes, packages) keep their kind and
 * their structured metadata, which is better than anything HTML scraping would
 * recover. But their `extra` is only a tagline and a description, so on the
 * first run the package-page PROSE was unsearchable — "abstain" and
 * "million-star" are both on package pages and neither matched.
 *
 * So where a collection entry and a built page share a URL, the page's text is
 * MERGED into that entry rather than either being dropped. Papers keep their
 * off-site URLs and are untouched.
 */
const existing = JSON.parse(readFileSync(INDEX, "utf8")).docs ?? [];
const byUrl = new Map(pages.map((p) => [p.url, p]));

const kept = existing
  .filter((d) => d.kind !== "page")
  .map((d) => {
    const page = byUrl.get(d.url);
    return page ? { ...d, extra: `${d.extra} ${page.extra}`.trim() } : d;
  });

const claimed = new Set(kept.map((d) => d.url));
const fresh = pages.filter((p) => !claimed.has(p.url));

/*
 * Coverage is guaranteed by construction — anything built and not excluded is
 * indexed — so the failure left to guard is a STALE exclusion: a page that was
 * deliberately held back, then renamed or deleted, leaving a silent entry that
 * would quietly hide a future page at the same URL.
 */
const builtUrls = new Set(
  walk(DIST).map(
    (f) => ("/" + relative(DIST, f).replace(/index\.html$/, "")).replace(/\/$/, "") || "/",
  ),
);
for (const [url, why] of EXCLUDED) {
  if (!builtUrls.has(url)) {
    problems.push(
      `${url} is excluded from search ("${why}") but no longer exists.\n` +
        `    Remove it from EXCLUDED in scripts/search/build-index.mjs.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`\n[search] ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

const docs = [...kept, ...fresh].sort((a, b) => a.url.localeCompare(b.url));
writeFileSync(INDEX, JSON.stringify({ docs }));

const bytes = statSync(INDEX).size;
console.log(
  `[search] ok — ${docs.length} documents (${kept.length} from collections, ` +
    `${fresh.length} pages), ${(bytes / 1024).toFixed(0)} kB`,
);
