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
export type Readiness = "developing" | "advanced" | "mature";

export const READINESS_LABEL: Record<Readiness, string> = {
  developing: "In development",
  advanced: "Far along",
  mature: "Mature",
};

/** Filled steps out of 3, for the readiness meter. */
export const READINESS_STEPS: Record<Readiness, number> = {
  developing: 1,
  advanced: 2,
  mature: 3,
};
