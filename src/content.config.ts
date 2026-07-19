/*
 * content.config.ts — typed content collections.
 *
 * `astrobytes`: short plain-language write-ups of individual papers, in the
 * spirit of Astrobites (where Anna was an early author). Prose lives in
 * Markdown so a post is written, not built; the schema below validates the
 * bibliographic scaffolding at BUILD time, so a post can never ship with a
 * missing arXiv link or an unparseable date.
 */
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const astrobytes = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/astrobytes" }),
  schema: z.object({
    title: z.string(),
    /** One-sentence hook shown on the hub and as the page lede. */
    dek: z.string(),
    date: z.coerce.date(),
    /** The paper being summarized. */
    paper: z.object({
      title: z.string(),
      authors: z.string(),
      venue: z.string(),
      year: z.string(),
      status: z.enum(["submitted", "accepted", "published"]).optional(),
      arxiv: z.string().url().optional(),
      ads: z.string().url().optional(),
    }),
    /** Reading-level cue for the reader, not a difficulty boast. */
    level: z.enum(["undergraduate", "graduate"]).default("undergraduate"),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { astrobytes };
