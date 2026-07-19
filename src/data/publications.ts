/*
 * publications.ts — featured first-author papers with plain-language
 * ("astrobites-style") summaries. Summaries are drafted from each paper's
 * published abstract and are pending Anna's review. The full record of 34
 * publications lives on ADS/ORCID.
 *
 * `authors`: wrap Anna's name in **…** for emphasis.
 */

export interface PubFigure {
  src: string;
  alt: string;
  caption: string;
  credit?: string;
  width: number;
  height: number;
  preliminary?: boolean;
  contain?: boolean;
}

export interface Publication {
  title: string;
  authors: string;
  venue: string;
  year: string;
  status?: "submitted" | null;
  arxiv?: string | null;
  ads?: string | null;
  /** Plain-language summary (what we did / found / why it matters). */
  summary: string;
  figure?: PubFigure;
}

export const featuredPublications: Publication[] = [
  {
    title:
      "Confidently Wrong: Why Ignoring Binaries Biases IMF Inference at Large Sample Sizes",
    authors: "**Rosen, A. L.**",
    venue: "The Astrophysical Journal",
    year: "2026",
    status: "submitted",
    arxiv: "https://arxiv.org/abs/2603.15779",
    ads: "https://ui.adsabs.harvard.edu/abs/2026arXiv260315779R/abstract",
    summary:
      "The stellar mass function's high-mass slope is usually measured by fitting single-star models to clusters — but most massive stars have unseen binary companions, and ignoring them biases the answer by a fixed amount. Because statistical error shrinks with sample size while this bias does not, huge upcoming surveys (Gaia, JWST, Roman, LSST) will report slopes that are precise yet wrong — a regime I call \"confidently wrong.\" A binary-aware analysis recovers the true slope.",
  },
  {
    title:
      "A Massive Star is Born: How Feedback from Stellar Winds, Radiation Pressure, and Collimated Outflows Limits Accretion onto Massive Stars",
    authors: "**Rosen, A. L.**",
    venue: "ApJ, 941, 202",
    year: "2022",
    arxiv: "https://arxiv.org/abs/2204.09700",
    ads: "https://ui.adsabs.harvard.edu/abs/2022ApJ...941..202R/abstract",
    summary:
      "As a massive star grows, its intense luminosity can drive winds that push back on the very gas it is trying to accrete. These 3D radiation-magnetohydrodynamic simulations — the first to include isotropic stellar winds alongside radiation and outflows — show the winds carve asymmetric, bipolar \"wind-tunnel\" bubbles and eventually shut off accretion onto ~30 M☉ stars. Building anything bigger therefore needs extra gas funneled in from the surrounding cloud.",
  },
  {
    title:
      "The Role of Outflows, Radiation Pressure, and Magnetic Fields in Massive Star Formation",
    authors: "**Rosen, A. L.**, Krumholz, M. R.",
    venue: "Astronomical Journal, 160, 78",
    year: "2020",
    arxiv: "https://arxiv.org/abs/2006.04829",
    ads: "https://ui.adsabs.harvard.edu/abs/2020AJ....160...78R/abstract",
    summary:
      "Which feedback actually limits how massive a forming star can get? These simulations pit magnetically-driven jets against radiation pressure. Protostellar outflows punch holes in the dusty envelope that let radiation leak out, and magnetic fields broaden the escaping outflow — making outflows a far more effective brake on a star's growth than radiation pressure alone.",
  },
  {
    title: "Zooming in on Individual Star Formation: Low- and High-mass Stars",
    authors:
      "**Rosen, A. L.**, Offner, S. S. R., Sadavoy, S. I., Bhandare, A., Vázquez-Semadeni, E., Ginsburg, A.",
    venue: "Space Science Reviews, 216, 62",
    year: "2020",
    arxiv: "https://arxiv.org/abs/2005.07717",
    ads: "https://ui.adsabs.harvard.edu/abs/2020SSRv..216...62R/abstract",
    summary:
      "A review of how stars form across scales — from giant molecular clouds down to the dense cores where individual stars ignite. It traces the past decade's leap in understanding, driven by multi-wavelength surveys, multi-physics simulations, and synthetic observations, for both low- and high-mass stars.",
  },
  {
    title:
      "Massive Star Formation via the Collapse of Subvirial and Virialized Turbulent Massive Cores",
    authors: "**Rosen, A. L.**, Li, P. S., Zhang, Q., Burkhart, B.",
    venue: "ApJ, 887, 108",
    year: "2019",
    arxiv: "https://arxiv.org/abs/1902.10153",
    ads: "https://ui.adsabs.harvard.edu/abs/2019ApJ...887..108R/abstract",
    summary:
      "Does a massive star's birth depend on how turbulent its parent core is? These radiation-hydrodynamic simulations compare \"subvirial\" cores (too weakly turbulent to hold themselves up) with virialized ones. Subvirial cores collapse fast and monolithically, while virialized cores fragment into many companions early on — though massive, unstable accretion disks eventually spawn companions either way.",
  },
  {
    title:
      "HARM²: A Highly Parallel Method for Radiation Hydrodynamics on Adaptive Grids",
    authors:
      "**Rosen, A. L.**, Krumholz, M. R., Oishi, J. S., Lee, A. T., Klein, R. I.",
    venue: "Journal of Computational Physics, 330, 924",
    year: "2017",
    arxiv: "https://arxiv.org/abs/1607.01802",
    ads: "https://ui.adsabs.harvard.edu/abs/2017JCoPh.330..924R",
    summary:
      "A new algorithm for the hard problem of radiation in star-formation simulations. HARM² combines ray-tracing for the sharp light of stars with a moment method for the diffuse, dust-reprocessed glow, runs on adaptive grids, and — thanks to a new non-blocking communication scheme — scales efficiently to thousands of processors.",
  },
  {
    title: "An Unstable Truth: How Massive Stars get their Mass",
    authors: "**Rosen, A. L.**, Krumholz, M. R., McKee, C. F., Klein, R. I.",
    venue: "MNRAS, 463, 2553",
    year: "2016",
    arxiv: "https://arxiv.org/abs/1607.03117",
    ads: "http://adsabs.harvard.edu/abs/2016MNRAS.463.2553R",
    summary:
      "How does gas reach a massive star against its blinding radiation? With a more accurate radiation method and properly resolved simulations, this work shows matter funnels onto the star through gravitational and Rayleigh–Taylor instabilities — filamentary channels threading through radiation-blown bubbles — settling a debate that had hinged on numerical resolution.",
  },
  {
    title:
      "Gone with the Wind: Where is the Missing Stellar Wind Energy from Massive Star Clusters?",
    authors:
      "**Rosen, A. L.**, Lopez, L. A., Krumholz, M. R., Ramirez-Ruiz, E.",
    venue: "MNRAS, 442, 2701",
    year: "2014",
    arxiv: "https://arxiv.org/abs/1405.1427",
    ads: "http://adsabs.harvard.edu/abs/2014MNRAS.442.2701R",
    summary:
      "Young massive clusters inject as much energy through stellar winds as through supernovae — but where does it go? Accounting for every energy channel in four well-studied clusters, this work finds none can absorb it, pointing to turbulent mixing or hot-gas leakage from H II regions as the missing sink — with real consequences for how clusters shape their surroundings.",
  },
  {
    title: "What Sets the Initial Rotation Rates of Massive Stars?",
    authors: "**Rosen, A. L.**, Krumholz, M. R., Ramirez-Ruiz, E.",
    venue: "ApJ, 748, 97",
    year: "2012",
    arxiv: "https://arxiv.org/abs/1201.4186",
    ads: "http://adsabs.harvard.edu/abs/2012ApJ...748...97R",
    summary:
      "Massive stars spin fast — but why? Low-mass stars get braked by magnetic coupling to their disks; this angular-momentum model shows the same brakes are far too weak for massive stars, which form too quickly and accrete too hard to be slowed. They are likely born as rapid rotators unless their disks survive far longer than observations suggest.",
  },
];
