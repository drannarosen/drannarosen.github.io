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
    /*
     * "science" is a paper explainer — the default, and what Astrobytes is
     * for. "meta" is a post about the work of building things (the site, the
     * software), which has no paper to cite. kind decides whether `paper` is
     * required, below.
     */
    kind: z.enum(["science", "meta"]).default("science"),
    title: z.string(),
    /** One-sentence hook shown on the hub and as the page lede. */
    dek: z.string(),
    date: z.coerce.date(),
    /** The paper being summarized. Required for science posts; absent for meta. */
    paper: z
      .object({
      title: z.string(),
      authors: z.string(),
      venue: z.string(),
      year: z.string(),
      status: z.enum(["submitted", "accepted", "published"]).optional(),
      arxiv: z.string().url().optional(),
      /*
       * REQUIRED. The post's title links to this, so a reader is always one
       * click from the record itself rather than from a summary of it — and
       * ADS is the record: it carries the abstract, the citation graph and
       * the published version, which an arXiv link alone does not.
       *
       * Required rather than optional because a link that is usually there is
       * a link a reader stops looking for. A new post without one fails the
       * build instead of quietly shipping an unlinked title.
       */
      ads: z.string().url(),
      })
      .optional(),
    provenance,
    /** Every quantitative claim in the post should trace to one of these. */
    sources: z.array(source).default([]),
    /** Reading-level cue for the reader, not a difficulty boast. */
    level: z.enum(["undergraduate", "graduate"]).default("undergraduate"),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  })
  .refine((d) => d.kind === "meta" || d.paper !== undefined, {
    message: "A science post must cite a paper (set `paper`), or set kind: meta.",
    path: ["paper"],
  }),
});

/*
 * `packages`: one entry per Jaxstro package. Frontmatter is the single source
 * of truth for structure (order, stage, readiness, links, figures); the MDX
 * body is prose that will grow as each package's methods paper lands. A page
 * must look deliberate with an empty body, so nothing here is required prose.
 */
const packages = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/packages" }),
  schema: z.object({
    /** Import name, lowercase — jaxstro, progenax, gravax, … */
    name: z.string(),
    /** 0 is the foundation; 1..n are pipeline stages in flow order. */
    order: z.number().int().min(0),
    stage: z.string(),
    tagline: z.string(),
    /** One-paragraph summary used on the index and as the page lede. */
    description: z.string(),
    /*
     * Optional shorter description for <meta name="description"> ONLY.
     *
     * `description` doubles as the visible page lede, so it is written for a
     * reader and can run long. Search engines truncate around 155 characters,
     * and the tail is where these descriptions carry their distinctive claim —
     * startrax lost its "in progress" qualifier that way, which made the
     * snippet read as a firmer claim than the page makes. Set this when the
     * lede exceeds ~155 characters; the page keeps the full text either way.
     */
    seoDescription: z.string().max(155).optional(),
    status: z.enum(["active-build", "established", "planned"]),
    readiness: z.enum(["developing", "advanced", "mature", "published"]),
    /** Free-text maturity note, e.g. "Mature · methods paper in prep". */
    maturity: z.string().optional(),
    repo: z.string().url().nullable().default(null),
    docs: z.string().url().nullable().default(null),
    /** The trailer: what is coming, stated concretely rather than teased. */
    upcoming: z.string().optional(),
    /*
     * Release track — a SEPARATE axis from `readiness`.
     *
     * `readiness` says how far the software has come. It says nothing about
     * whether anyone can get it, and the two had silently merged: packages sat
     * at "mature" with `repo: null`, which reads to a visitor as vapour rather
     * than as a deliberate hold. The code opens when the paper it documents is
     * out, and the page should say so rather than leave a reader guessing.
     *
     * Venues are deliberately absent. A methods paper and a software paper are
     * different kinds of thing and that distinction is worth stating; which
     * journal each lands in is not settled and must not be implied.
     */
    papers: z
      .object({
        /** The science/methods paper. Absent where none is planned. */
        methods: z.enum(["planned", "in-preparation", "submitted", "published"]).optional(),
        /** The short software paper. */
        software: z.enum(["planned", "in-preparation", "submitted", "published"]).optional(),
      })
      .optional(),
    /** When the source opens. Defaults to "with-paper" — see above. */
    codeRelease: z.enum(["with-paper", "public"]).default("with-paper"),

    /*
     * Figures are REFERENCED, not described. Everything about the image —
     * path, alt text, dimensions, title, credit and caption — lives once in
     * src/data/figures.json and resolves through src/lib/figures.ts.
     *
     * Five of ten figures appear on more than one page, and while each page
     * carried its own copy of the caption they could disagree: a replacement
     * gravax figure once left /research asserting the previous run's number.
     * Only genuinely per-page choices survive here, and they are layout.
     */
    figures: z
      .array(
        z.object({
          /** Figure id — the filename without its extension. */
          id: z.string(),
          /**
           * Where the caption sits. "side" is for tall figures: putting the
           * caption alongside halves the image's height instead of letting a
           * portrait dominate the page.
           */
          captionPlacement: z.enum(["below", "side", "above"]).default("below"),
        }),
      )
      .default([]),
    draft: z.boolean().default(false),
  }),
});

/*
 * explore-plan — INTERNAL planning specs for the "Lives & Deaths of Star
 * Clusters" explorable series. Rendered only by the dev-only /explore-plan
 * section (never built in production), so this is a working design surface, not
 * published content. One entry per overview / chapter / interactive / spin-off.
 */
const explorePlan = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/explore-plan" }),
  schema: z.object({
    title: z.string(),
    kind: z.enum(["overview", "chapter", "interactive", "spinoff", "tooling"]),
    order: z.number().default(0),
    status: z.enum(["idea", "draft", "spec", "building", "shipped"]).default("draft"),
    /** One line shown under the title in the index. */
    tagline: z.string().optional(),
    /** Anna's research/software this step draws on (progenax, HARM², …). */
    research: z.array(z.string()).default([]),
    /** For a chapter: the interactive tool page(s) it links off to. */
    tools: z.array(z.string()).default([]),
    /** Deep-dive spin-offs branching from this step. */
    spinoffs: z.array(z.string()).default([]),
    /** Which curated tours include this step. */
    tours: z.array(z.enum(["outreach", "undergrad", "research"])).default([]),
  }),
});

export const collections = { astrobytes, packages, explorePlan };
