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
    /** Short, memorable name for the demo — a headline, not a label. */
    title: string;
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
    figure: {
      title: "Born Where the Gas Is",
      src: "/images/research/gravoturb-cluster.webp",
      alt: "Three panels: a synthetic cluster's natal gas surface density with an embedded stellar population, then the same stars placed without and with mass–gas coupling, coloured by spectral type from blue O stars to red M stars.",
      caption:
        "A truth-known synthetic cluster: natal gas surface density with an IMF-sampled population (left), then the same stars placed without (centre) and with (right) mass–gas coupling. With coupling on, massive O and B stars preferentially sit in dense gas — primordial mass segregation as a knob you can turn, which is what makes it testable.",
      width: 1600,
      height: 486,
      preliminary: true,
    },
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
      title: "The Gradients Are Real",
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
    figure: {
      title: "What Rubin Actually Sees",
      src: "/images/software/fluxax-lsst-synthetic.webp",
      alt: "Two synthetic LSST r-band images side by side. Left: a sparse cluster of 400 stars, each a separate point source. Right: a crowded core of 1800 stars whose central profiles merge into a single saturated blend.",
      caption:
        "The same forward model run on a sparse cluster (left, 400 stars) and a crowded core (right, 1800 stars): PSF FWHM 0.7 arcsec, 0.2 arcsec per pixel, Poisson–Gaussian noise, at 6.3 kpc. In the crowded case individual stars stop being individually measurable — blending is physics the model has to carry, not a nuisance to correct away afterwards.",
      width: 1950,
      height: 930,
      preliminary: true,
    },
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
    figure: {
      title: "The Telescope Adds Ten Pounds",
      src: "/images/software/informax-telescope-adds-ten-pounds.webp",
      alt: "Three panels showing binaries raising the line-of-sight velocity dispersion, binary-blind mass estimates near three times the truth against a calibrated control and binary-aware recovery, and radial target allocations shifting between mass-first and degeneracy-first observing designs.",
      caption:
        "Unresolved binaries inflate the observed velocity dispersion (a). A binary-blind fit turns that orbital motion into 2.9 times the true cluster mass — while forecasting 4.5% precision, a bias 42 times its own error bar. The control isolates the cause; binary-aware inference recovers both mass and binary fraction (b). Then the design question: a mass-first allocation buys 6.9% mass precision but leaves a 40% blind spot, while a degeneracy-first design halves that blind spot for two points of mass precision (c). Truth-known experiment, 96 mocks.",
      width: 2469,
      height: 772,
      preliminary: true,
    },
  },
];

export const allPackages: JaxstroPackage[] = [foundation, ...pipeline];
