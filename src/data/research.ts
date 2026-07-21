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

/*
 * A REFERENCE to a figure, not a description of one. Path, alt text,
 * dimensions, credit and caption all live once in src/data/figures.json —
 * this page shows several figures that also appear on their package pages,
 * and while each place carried its own copy they could disagree. One did:
 * a replacement gravax figure left this page asserting the previous run's
 * number, off by four orders of magnitude.
 */
export interface ResearchFigure {
  /** Figure id — the filename without its extension. */
  id: string;
  /** Fit the whole figure rather than filling its box. Layout, not content. */
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
      id: "informax-telescope-adds-ten-pounds",
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
      id: "gravax-demo-01",
    },
  },
];
