/*
 * jaxstro.ts — typed model of the JAXSTRO ecosystem. Single source of truth:
 * the ecosystem diagram and the package cards both render from this array.
 *
 * IMPORTANT (per Anna): no package is publicly released yet — methods papers
 * come first. Every package is therefore "active-build"; the `maturity` field
 * conveys how far along each is, without implying a public release. Add repo/
 * docs URLs only when a package actually goes public.
 */

export type PackageStatus = "active-build" | "established" | "planned";

export interface JaxstroPackage {
  /** Package name (lowercase, as imported). */
  name: string;
  /** Pipeline stage label. */
  stage: string;
  /** One-line description. */
  tagline: string;
  /** Fuller description of what it owns. */
  description: string;
  status: PackageStatus;
  /** How far along, shown as a small note (e.g. "Mature · methods paper in prep"). */
  maturity?: string;
  repo?: string | null;
  docs?: string | null;
}

export const STATUS_LABEL: Record<PackageStatus, string> = {
  "active-build": "Active build",
  established: "Established",
  planned: "Planned",
};

/** The shared numerical foundation every package builds on. */
export const foundation: JaxstroPackage = {
  name: "jaxstro",
  stage: "Foundation",
  tagline: "The shared numerical substrate.",
  description:
    "Units and constants, coordinate transforms, numerical methods, derivative contracts, and provenance — so every package composes without silent inconsistencies.",
  status: "active-build",
  maturity: "Mature · methods paper in prep",
  repo: null,
  docs: null,
};

/** The differentiable birth-to-observation pipeline, in flow order. */
export const pipeline: JaxstroPackage[] = [
  {
    name: "progenax",
    stage: "Birth populations",
    tagline: "Truth-known cluster birth conditions.",
    description:
      "Differentiable IMFs (including environment-dependent forms), mass-dependent multiplicity, and true-equilibrium King/EFF/LIMEPY structure with anisotropy and primordial mass segregation.",
    status: "active-build",
    maturity: "Mature · methods paper in prep",
    repo: null,
    docs: null,
  },
  {
    name: "gravax",
    stage: "Dynamics",
    tagline: "Differentiable collisional dynamics.",
    description:
      "A three-tier MSM ⊕ Hermite ⊕ SDAR engine that resolves close encounters exactly while accelerating cluster-wide gravity — mapping how dynamics preserves, transforms, or erases birth structure.",
    status: "active-build",
    maturity: "In active development",
    repo: null,
    docs: null,
  },
  {
    name: "startrax",
    stage: "Stellar evolution",
    tagline: "From birth mass to stellar state and remnants.",
    description:
      "A differentiable map from (initial mass, age, metallicity) to full stellar state — winds, mass loss, lifetimes, remnants — with a differentiable binary-evolution layer in progress.",
    status: "active-build",
    maturity: "In active development",
    repo: null,
    docs: null,
  },
  {
    name: "fluxax",
    stage: "Observables",
    tagline: "Physical states → survey observables.",
    description:
      "Differentiable Gaia and Rubin/LSST photometry, astrometry, and images, propagated through selection, crowding, PSFs, backgrounds, and noise.",
    status: "active-build",
    maturity: "Far along",
    repo: null,
    docs: null,
  },
  {
    name: "informax",
    stage: "Inference & design",
    tagline: "What the data can actually recover.",
    description:
      "Fisher information geometry and optimal experimental design, simulation-based calibration and coverage, and refusal contracts that decline false precision for unconstrained parameters.",
    status: "active-build",
    maturity: "Far along · substantively validated",
    repo: null,
    docs: null,
  },
];

export const allPackages: JaxstroPackage[] = [foundation, ...pipeline];
