/*
 * jaxstro.ts — presentation constants for the Jaxstro packages.
 *
 * The package DATA now lives in the `packages` content collection
 * (src/content/packages/*.mdx) so each one can carry prose that grows as its
 * methods paper lands; read it through src/lib/packages.ts. What stays here is
 * only how to LABEL that data, which is a UI concern and belongs with the UI.
 *
 * IMPORTANT (per Anna): no package is publicly released yet — methods papers
 * come first. Every package is therefore "active-build"; `readiness` conveys
 * how far along each is, without implying a public release.
 */

export type PackageStatus = "active-build" | "established" | "planned";

export const STATUS_LABEL: Record<PackageStatus, string> = {
  "active-build": "Active build",
  established: "Established",
  planned: "Planned",
};

/**
 * How far along a package is, as an ordinal so the page can SHOW it rather
 * than bury it in prose. Every package currently shares one `status`, which
 * makes that field carry no information; readiness is what actually differs.
 */
export type Readiness = "developing" | "advanced" | "mature" | "published";

export const READINESS_LABEL: Record<Readiness, string> = {
  developing: "In development",
  advanced: "Far along",
  mature: "Mature",
  published: "Published",
};

/** Filled steps out of 4, for the readiness meter. */
export const READINESS_STEPS: Record<Readiness, number> = {
  developing: 1,
  advanced: 2,
  mature: 3,
  published: 4,
};

/** Total steps in the meter; the last is reached on public release. */
export const READINESS_TOTAL = 4;

/*
 * Release track labels — kept beside the readiness labels because they answer
 * the question readiness does not: when can anyone actually use this.
 *
 * Venue-neutral on purpose. "Methods paper" and "software paper" name kinds of
 * publication, not journals; nothing here should imply a venue that has not
 * been chosen.
 */
export type PaperState = "planned" | "in-preparation" | "submitted" | "published";

export const PAPER_STATE_LABEL: Record<PaperState, string> = {
  planned: "planned",
  "in-preparation": "in preparation",
  submitted: "under review",
  published: "published",
};

/*
 * How full the paper meter reads, mirroring the four-step readiness meter so
 * the two bars share a visual language. A paper advances only when Anna says
 * so; nothing here derives a paper's state from how far the software has come.
 */
export const PAPER_STATE_STEPS: Record<PaperState, number> = {
  planned: 1,
  "in-preparation": 2,
  submitted: 3,
  published: 4,
};

export const PAPER_STATE_TOTAL = 4;

export type CodeRelease = "with-paper" | "public";

export const CODE_RELEASE_LABEL: Record<CodeRelease, string> = {
  "with-paper": "Source opens with the paper",
  public: "Source public",
};
