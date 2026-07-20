/*
 * packages.ts — the one way to read the Jaxstro package collection.
 *
 * Package data used to live in src/data/jaxstro.ts. It now lives in
 * src/content/packages/*.mdx so each package can carry real prose that grows
 * as its methods paper lands. That module keeps only presentation constants
 * (readiness labels, status labels) — no data — so there is a single source of
 * truth and the ecosystem diagram, the index, the CV and the detail pages
 * cannot drift apart.
 */
import { getCollection, type CollectionEntry } from "astro:content";

export type PackageEntry = CollectionEntry<"packages">;

/** All packages in pipeline order: 0 is the foundation, 1..n the stages. */
export async function getPackages(): Promise<PackageEntry[]> {
  const all = await getCollection("packages", ({ data }) => !data.draft);
  return all.sort((a, b) => a.data.order - b.data.order);
}

/** The foundation (order 0) and the pipeline stages, split for layout. */
export async function getPipeline(): Promise<{
  foundation: PackageEntry | undefined;
  stages: PackageEntry[];
}> {
  const all = await getPackages();
  return {
    foundation: all.find((p) => p.data.order === 0),
    stages: all.filter((p) => p.data.order > 0),
  };
}

/** Route for a package's detail page. */
export const packageHref = (p: PackageEntry) => `/software/${p.id}`;
