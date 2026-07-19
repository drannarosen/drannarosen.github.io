/*
 * jaxstro.ts — typed model of the Jaxstro ecosystem. Single source of truth:
 * the ecosystem diagram and the package cards both render from this array.
 *
 * IMPORTANT (per Anna): no package is publicly released yet — methods papers
 * come first. Every package is therefore "active-build"; the `maturity` field
 * conveys how far along each is, without implying a public release. Add repo/
 * docs URLs only when a package actually goes public.
 */

export type PackageStatus = "active-build" | "established" | "planned";

/**
 * How far along a package is, as an ordinal so the page can SHOW it rather
 * than bury it in prose. Every package currently shares one `status`, which
 * makes that field carry no information; readiness is what actually differs.
 * These are a faithful re-encoding of the `maturity` notes below, not new
 * claims about any package.
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
  /** Ordinal form of `maturity`, so the UI can rank rather than just print. */
  readiness: Readiness;
  repo?: string | null;
  docs?: string | null;
  /**
   * Optional proof-of-concept figure: evidence the package does what it claims,
   * without publishing a scientific result. `preliminary` is not decoration —
   * it mirrors `production_validated: false` in gravax's own provenance record.
   */
  figure?: {
    src: string;
    alt: string;
    caption: string;
    width: number;
    height: number;
    preliminary?: boolean;
  };
}

export const STATUS_LABEL: Record<PackageStatus, string> = {
  "active-build": "Active build",
  established: "Established",
  planned: "Planned",
};

/** The shared numerical foundation every package builds on. */
export const foundation: JaxstroPackage = {
  name: "jaxstro",
  readiness: "mature",
  stage: "Foundation",
  tagline: "The shared numerical substrate.",
  description:
    "Units and constants, coordinate transforms, numerical methods, derivative contracts, and provenance — so every package composes without silent inconsistencies.",
  status: "active-build",
  maturity: "Mature · methods paper in prep",
  repo: null,
  docs: "https://jaxstro.github.io/jaxstro/",
};

/** The differentiable birth-to-observation pipeline, in flow order. */
export const pipeline: JaxstroPackage[] = [
  {
    name: "progenax",
    readiness: "mature",
    stage: "Birth populations",
    tagline: "Truth-known cluster birth conditions.",
    description:
      "Differentiable IMFs (including environment-dependent forms), mass-dependent multiplicity, and true-equilibrium King/EFF/LIMEPY structure with anisotropy and primordial mass segregation.",
    status: "active-build",
    maturity: "Mature · methods paper in prep",
    repo: null,
    docs: "https://jaxstro.github.io/progenax/",
  },
  {
    name: "gravax",
    readiness: "developing",
    stage: "Dynamics",
    tagline: "Differentiable collisional dynamics.",
    description:
      "A three-tier MSM ⊕ Hermite ⊕ SDAR engine that resolves close encounters exactly while accelerating cluster-wide gravity — mapping how dynamics preserves, transforms, or erases birth structure.",
    status: "active-build",
    maturity: "In active development",
    repo: null,
    docs: null,
    figure: {
      src: "/images/software/gravax-eff-imf-n512.webp",
      alt: "Three panels. (a) A 512-star cluster in the x-y plane, points sized and coloured by stellar mass, with half-mass radii marked at t=0 and after three crossing times, and a central massive binary. (b) Cluster and binary scales versus time in units of the half-mass crossing time: the half-mass and 90-percent radii expand while the binary semimajor axis contracts in discrete steps. (c) Autodiff derivatives plotted against finite-difference derivatives for ten clusters, lying on the one-to-one line, with residuals of order 1e-9 in an inset.",
      caption:
        "A 512-star EFF cluster with a 31+28 M\u2609 hard binary, evolved for three half-mass crossing times. The binary hardens from 1000 to 896 AU while the cluster expands, and relative energy drift stays below 2\u00d710\u207b\u2075. Panel (c) is the point: autodiff gradients match finite differences to ~10\u207b\u2079, so the differentiability claim is measured, not asserted.",
      width: 2518,
      height: 1888,
      preliminary: true,
    },
  },
  {
    name: "startrax",
    readiness: "developing",
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
    readiness: "advanced",
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
    readiness: "advanced",
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
