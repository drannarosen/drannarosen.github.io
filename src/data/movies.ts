/*
 * /movies — the simulation movies from the massive-star-formation work.
 *
 * Ported from the WordPress site this replaced, read from the Internet
 * Archive's 2020-10-30 capture of anna-rosen.com/movies/. Run names, physical
 * parameters and descriptions are Anna's own text from that page, unchanged
 * except for typography (M_sun as a real symbol, an en dash in "20 AU").
 *
 * The four YouTube ids were taken from the same capture and each was confirmed
 * on 2026-08-04 to still resolve, on Anna's own channel; the video titles
 * independently corroborate the run each is attached to (e.g. the id recorded
 * against LamFLD is titled "LamFLD multipanel density video").
 *
 * WHY THIS PAGE EXISTS AT /movies AND NOT A NEW PATH: it is the URL the old
 * site used, so restoring the page here means the old links resolve to the
 * real thing instead of to a redirect stub.
 */

export type SimulationMovie = {
  /** Run label as used in the paper. */
  readonly run: string;
  /** The one-line configuration gloss that followed the run name. */
  readonly configuration: string;
  readonly youtubeId: string;
  readonly description: string;
};

export const movies: readonly SimulationMovie[] = [
  {
    run: "LamRT+FLD",
    configuration: "hybrid radiative transfer, laminar initial conditions",
    youtubeId: "HBBQH4rTEhk",
    description:
      "Adaptive mesh refinement (AMR) simulation of the collapse of a 150 M☉ laminar core with 20 AU maximum resolution and hybrid radiative transfer.",
  },
  {
    run: "LamRT+FLD_LR",
    configuration: "low-resolution comparison run",
    youtubeId: "OSoNfSGxRHk",
    description:
      "Low-resolution AMR simulation of the collapse of a 150 M☉ laminar core with 40 AU maximum resolution and hybrid radiative transfer. Bubble shells are no longer adaptively refined, to show that instabilities developing at bubble shells must be resolved in order to grow.",
  },
  {
    run: "LamFLD",
    configuration: "FLD-only comparison run",
    youtubeId: "auTBC_Xj32g",
    description:
      "AMR simulation of the collapse of a 150 M☉ laminar core with 20 AU maximum resolution, using only the flux-limited diffusion (FLD) approximation for radiative transfer.",
  },
  {
    run: "TurbRT+FLD",
    configuration: "hybrid radiative transfer, turbulent initial conditions",
    youtubeId: "SgYwNoPMmGE",
    description:
      "AMR simulation of the collapse of a 150 M☉ turbulent core with 20 AU maximum resolution and hybrid radiative transfer.",
  },
];

/*
 * The two papers behind these runs. Both records are copied from
 * src/data/publications.ts so the venue strings and ADS/arXiv links here can
 * never disagree with the publications page; the titles are the ones used
 * there.
 */
export type MoviePaper = {
  readonly title: string;
  readonly authors: string;
  readonly venue: string;
  readonly year: string;
  readonly role: string;
  readonly ads: string;
  readonly arxiv: string;
};

export const moviePapers: readonly MoviePaper[] = [
  {
    title: "An Unstable Truth: How Massive Stars get their Mass",
    authors: "Rosen, A. L., Krumholz, M. R., McKee, C. F., Klein, R. I.",
    venue: "MNRAS, 463, 2553",
    year: "2016",
    role: "The simulations shown on this page.",
    ads: "https://ui.adsabs.harvard.edu/abs/2016MNRAS.463.2553R/abstract",
    arxiv: "https://arxiv.org/abs/1607.03117",
  },
  {
    title: "HARM²: A Highly Parallel Method for Radiation Hydrodynamics on Adaptive Grids",
    authors: "Rosen, A. L., Krumholz, M. R., Oishi, J. S., Lee, A. T., Klein, R. I.",
    venue: "Journal of Computational Physics, 330, 924",
    year: "2017",
    role: "The radiation method these runs use.",
    ads: "https://ui.adsabs.harvard.edu/abs/2017JCoPh.330..924R/abstract",
    arxiv: "https://arxiv.org/abs/1607.01802",
  },
];
