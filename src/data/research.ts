/*
 * research.ts — the research program framed as driving questions rather than
 * topic categories. Grounded in Anna's published work and current direction;
 * deliberately broader than any single proposal. Edit here to reshape the
 * Research page.
 */

export interface RelatedLink {
  label: string;
  href: string;
}

export interface ResearchFigure {
  src: string;
  alt: string;
  caption: string;
  credit?: string;
  width: number;
  height: number;
  preliminary?: boolean;
  contain?: boolean;
}

export interface ResearchQuestion {
  /** The driving question. */
  question: string;
  /** 2–3 sentence framing in Anna's voice. */
  summary: string;
  /** Short thread tags — sub-threads within the question. */
  threads: string[];
  /** Optional links to software, publications, etc. */
  related?: RelatedLink[];
  /** Optional supporting figure. */
  figure?: ResearchFigure;
}

export const researchQuestions: ResearchQuestion[] = [
  {
    question: "How do massive stars assemble against their own feedback?",
    summary:
      "Massive stars shape galaxies even as they form — launching radiation, winds, and collimated outflows that push back on the gas feeding them. I build radiation-magnetohydrodynamic models to ask how a star keeps gaining mass despite forces strong enough to reverse its own accretion.",
    threads: [
      "Radiation pressure",
      "Protostellar outflows",
      "Magnetic fields",
      "Accretion",
    ],
    related: [{ label: "Selected publications", href: "/cv#cv-pubs" }],
  },
  {
    question: "How does stellar feedback sculpt clusters and the interstellar medium?",
    summary:
      "The winds, radiation, and supernovae of young massive clusters carve bubbles, stir turbulence, and regulate further star formation. I connect simulations to multi-wavelength observations — from X-rays to the far-infrared — to trace where that feedback energy actually goes.",
    threads: [
      "Stellar winds",
      "H II regions & superbubbles",
      "Turbulence",
      "30 Doradus & the LMC",
    ],
  },
  {
    question: "What can observations genuinely tell us about stellar populations?",
    summary:
      "The initial mass function, binarity, and cluster structure are all inferred from incomplete data. I've shown that ignoring unresolved binaries can make high-mass IMF conclusions confidently wrong as samples grow. I want to know what surveys like Rubin and Gaia can — and cannot — actually recover.",
    threads: [
      "The initial mass function",
      "Unresolved binaries",
      "Identifiability",
      "Rubin/LSST & Gaia",
    ],
    related: [{ label: "Selected publications", href: "/cv#cv-pubs" }],
    figure: {
      src: "/images/software/informax-telescope-adds-ten-pounds.webp",
      alt: "Three panels showing binaries raising the line-of-sight velocity dispersion, binary-blind mass estimates near three times the truth against a calibrated control and binary-aware recovery, and radial target allocations shifting between mass-first and degeneracy-first observing designs.",
      caption:
        "Unresolved binaries inflate the observed velocity dispersion, and a binary-blind fit turns that orbital motion into 2.9 times the true cluster mass — while forecasting 4.5% precision. That is a bias 42 times its own error bar. Modelling the binaries recovers both the mass and the binary fraction, and the same machinery then says where to point the telescope next.",
      credit: "A. L. Rosen · Jaxstro (informax). Preliminary.",
      width: 2469,
      height: 772,
      preliminary: true,
    },
  },
  {
    question: "How can differentiable models transform astrophysical inference?",
    summary:
      "If every step from a system's birth to its observed light is a differentiable function, we can compute exactly how each observable responds to the underlying physics — and design the observations most likely to break a degeneracy. This is the idea behind the Jaxstro ecosystem, and it reaches well beyond any one problem.",
    threads: [
      "Automatic differentiation",
      "Forward modeling",
      "Optimal experimental design",
      "Scientific software",
    ],
    related: [{ label: "The Jaxstro ecosystem", href: "/software" }],
    figure: {
      src: "/images/software/gravax-eff-imf-n512.webp",
      alt: "Three panels. A 512-star cluster in the x-y plane with a central massive binary; cluster and binary scales versus time showing the cluster expanding while the binary semimajor axis contracts; and autodiff derivatives plotted against finite-difference derivatives on the one-to-one line with residuals near 1e-9.",
      caption:
        "A differentiable model has to earn the word. Here a 512-star cluster with a hard massive binary is evolved for three crossing times — the binary hardens, the cluster expands — and the gradients of that whole calculation match finite differences to about one part in a billion. That is what makes the model invertible against data rather than merely runnable.",
      credit: "A. L. Rosen · Jaxstro (gravax). Preliminary.",
      width: 2512,
      height: 778,
      preliminary: true,
    },
  },
];
