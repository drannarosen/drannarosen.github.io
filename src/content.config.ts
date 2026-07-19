/*
 * content.config.ts — typed content collections.
 *
 * `astrobytes`: short plain-language write-ups of individual papers, in the
 * spirit of Astrobites (where Anna was an early author). Prose lives in
 * Markdown/MDX so a post is written, not built; the schema below validates the
 * bibliographic scaffolding at BUILD time, so a post can never ship with a
 * missing arXiv link or an unparseable date.
 *
 * PROVENANCE: the review requirement is enforced by the schema rather than by a
 * separate linter, so an AI-drafted post with no sign-off cannot build at all.
 * A gate that only warns is a gate that gets ignored.
 * See docs/plans/2026-07-19-content-integrity-design.md.
 */
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/** How a page came to exist. Disclosed publicly on the page. */
const provenance = z
  .object({
    authorship: z.enum(["human", "ai-drafted", "machine-generated"]),
    /** Who signed off. Required unless a human wrote it unaided. */
    reviewedBy: z.string().optional(),
    reviewedOn: z.coerce.date().optional(),
    /** Which model was involved, when one was. */
    model: z.string().optional(),
    /** Free-text note on what the review actually checked. */
    note: z.string().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.authorship === "human") return;
    for (const field of ["reviewedBy", "reviewedOn", "model"] as const) {
      if (!p[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message:
            `provenance.${field} is required when authorship is "${p.authorship}". ` +
            "Nothing a model touched may publish without a named reviewer, a " +
            "review date, and the model that produced it.",
        });
      }
    }
  });

/** A source a quantitative claim can point at. */
const source = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string().url(),
});

const astrobytes = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/astrobytes" }),
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
    provenance,
    /** Every quantitative claim in the post should trace to one of these. */
    sources: z.array(source).default([]),
    /** Reading-level cue for the reader, not a difficulty boast. */
    level: z.enum(["undergraduate", "graduate"]).default("undergraduate"),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { astrobytes };
