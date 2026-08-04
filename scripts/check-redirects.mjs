#!/usr/bin/env node
/*
 * check-redirects.mjs — every redirect must point at a page that exists.
 *
 * astro.config.mjs holds redirects from URLs the old WordPress site used, so
 * that a link written years ago in a talk slide, a paper footnote or someone's
 * bookmarks still lands somewhere. GitHub Pages has no server-side redirects,
 * so Astro emits each as a real page carrying a meta refresh.
 *
 * The failure this catches: a redirect TARGET gets renamed or removed. The
 * stub keeps building, keeps validating, and keeps forwarding visitors to a
 * 404 — the redirect looks healthy from every angle except a visitor's. Astro
 * does not check this; it will happily emit a stub pointing at nothing.
 *
 * Also fails when a redirect SOURCE has become a real page, which means the
 * page was restored and the redirect is now dead config shadowing it. That
 * happened to /movies and /news: both were restored as real pages, so neither
 * needs (or should have) an entry in `redirects`.
 *
 * Runs on dist/ in postbuild, alongside check-links.mjs.
 *
 *   node scripts/check-redirects.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

if (!existsSync(dist)) {
  console.error("[redirects] dist/ not found — run after `astro build`.");
  process.exit(1);
}

/** Astro's config is an ESM module; import it rather than parsing it. */
const config = (await import(pathToFileURL(join(root, "astro.config.mjs")).href)).default;
const redirects = config.redirects ?? {};

/** A path is "built" if dist has <path>/index.html or <path>.html. */
const built = (p) => {
  const clean = p.replace(/^\/+|\/+$/g, "");
  if (clean === "") return existsSync(join(dist, "index.html"));
  return (
    existsSync(join(dist, clean, "index.html")) || existsSync(join(dist, `${clean}.html`))
  );
};

const problems = [];

for (const [from, to] of Object.entries(redirects)) {
  const target = typeof to === "string" ? to : to?.destination;

  if (!target) {
    problems.push(`${from} — redirect has no destination`);
    continue;
  }

  // External destinations are check-links.mjs's job, not this one's.
  if (/^https?:\/\//.test(target)) continue;

  if (!built(target)) {
    problems.push(`${from} -> ${target} — destination is not a built page`);
  }

  // The stub itself must exist, or the old URL 404s despite the config.
  if (!built(from)) {
    problems.push(`${from} — no redirect stub was emitted`);
  }
}

/*
 * A source that is also a real page: the source stub and the page collide, and
 * whichever wins, the config is a lie. Astro emits the stub, so the page loses.
 */
for (const from of Object.keys(redirects)) {
  const clean = from.replace(/^\/+|\/+$/g, "");
  const pageSrc = [
    join(root, "src/pages", `${clean}.astro`),
    join(root, "src/pages", clean, "index.astro"),
  ];
  if (pageSrc.some(existsSync)) {
    problems.push(
      `${from} — a real page exists at this path; remove the redirect (it shadows the page)`,
    );
  }
}

if (problems.length) {
  console.error("[redirects] FAILED");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\n  Fix by pointing the redirect at a page that exists, restoring the\n" +
      "  target page, or deleting the redirect if its path is a real page now.",
  );
  process.exit(1);
}

const n = Object.keys(redirects).length;
console.log(`[redirects] ok — ${n} redirect${n === 1 ? "" : "s"}, every destination is a built page`);
