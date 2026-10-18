import { getCollection, type CollectionEntry } from "astro:content";

/*
 * The astrobytes a page may show. A draft is an unreviewed post: the dev
 * server renders it so it can be reviewed in place, and a production build
 * never builds it, so nothing unreviewed can deploy. RSS, search and the
 * /publications cross-link ask for published posts only, in every mode.
 */
export async function getAstrobytes(
  { includeDrafts = import.meta.env.DEV }: { includeDrafts?: boolean } = {},
): Promise<CollectionEntry<"astrobytes">[]> {
  return getCollection("astrobytes", ({ data }) => includeDrafts || !data.draft);
}
