/*
 * cv.ts — structured CV data (source: Anna's maintained Typst CV).
 * The /cv page renders entirely from this module. Kept curated, not
 * exhaustive: the full record lives in the downloadable PDF. Nothing here is
 * invented — every entry traces to the CV.
 */

export interface DatedEntry {
  role: string;
  org?: string;
  date: string;
  note?: string;
}

export interface Publication {
  title: string;
  authors: string; // Anna's name wrapped in **bold** for emphasis
  venue: string;
  year: string;
  ads?: string | null;
  status?: "submitted" | "accepted" | null;
}

export const cvProfile = {
  name: "Anna Lorraine Rosen, Ph.D.",
  role: "Computational Astrophysicist",
  title: "Assistant Professor of Astronomy, San Diego State University",
  orcid: "https://orcid.org/0000-0003-4423-0660",
  /** Set when a PDF is hosted at /documents/. Null → the download link hides. */
  pdf: null as string | null,
  stats: [
    { value: "34", label: "Publications" },
    { value: "55+", label: "Invited talks" },
    { value: "9", label: "Grad students mentored" },
    { value: "5", label: "Courses developed" },
  ],
  interests: [
    "Differentiable stellar astrophysics",
    "Star clusters & stellar populations",
    "The initial mass function & inference",
    "Massive-star formation & feedback",
    "Radiation (magneto)hydrodynamics",
    "GPU-native & scientific software",
  ],
};

export const employment: DatedEntry[] = [
  { role: "Assistant Professor, Department of Astronomy", org: "San Diego State University", date: "2023–Present" },
  { role: "UC Chancellor's Postdoctoral Fellowship", org: "UC San Diego", date: "2022–2023" },
  { role: "NSF Astronomy & Astrophysics Postdoctoral Fellowship", org: "UC San Diego", date: "2022–2023" },
  { role: "ITC Postdoctoral Fellowship", org: "Harvard University", date: "2020–2022" },
  { role: "NASA Einstein Postdoctoral Fellowship", org: "Harvard University", date: "2017–2020" },
];

export const education: DatedEntry[] = [
  { role: "Ph.D., Astronomy & Astrophysics", org: "UC Santa Cruz", date: "2017", note: "Thesis: The Destructive Birth of Massive Stars & Massive Star Clusters" },
  { role: "M.S., Astronomy & Astrophysics", org: "UC Santa Cruz", date: "2012" },
  { role: "B.A., Physics & Astrophysics (double major)", org: "UC Berkeley", date: "2009" },
  { role: "Community College Transfer Student", org: "Los Angeles Pierce College", date: "2007" },
];

/** Selected awards; the full list is in the PDF. */
export const awards: DatedEntry[] = [
  { role: "Assigned Time for Research", org: "SDSU Division of Research & Innovation", date: "2026" },
  { role: "ATHENA Faculty Champion", org: "SDSU", date: "2024" },
  { role: "DRI GREW Fellowship", org: "SDSU", date: "2024" },
  { role: "Rodger Doxsey Dissertation Prize", org: "American Astronomical Society", date: "2017" },
  { role: "ARCS Foundation Fellowship", date: "2016" },
  { role: "Excellence in Mentoring Award", org: "UC Santa Cruz Astronomy", date: "2015" },
  { role: "NSF Graduate Research Fellowship", date: "2011" },
];

/** Selected first-author publications. Full list of 34 on ADS / in the PDF. */
export const selectedPublications: Publication[] = [
  {
    title: "Confidently Wrong: Why Ignoring Binaries Biases IMF Inference at Large Sample Sizes",
    authors: "**Rosen, A. L.**",
    venue: "The Astrophysical Journal",
    year: "2026",
    status: "submitted",
    ads: "https://ui.adsabs.harvard.edu/abs/2026arXiv260315779R/abstract",
  },
  {
    title: "A Massive Star is Born: How Feedback from Stellar Winds, Radiation Pressure, and Collimated Outflows Limits Accretion onto Massive Stars",
    authors: "**Rosen, A. L.**",
    venue: "ApJ, 941, 202",
    year: "2022",
    ads: "https://ui.adsabs.harvard.edu/abs/2022ApJ...941..202R/abstract",
  },
  {
    title: "The Role of Outflows, Radiation Pressure, and Magnetic Fields in Massive Star Formation",
    authors: "**Rosen, A. L.**, Krumholz, M. R.",
    venue: "Astronomical Journal, 160, 78",
    year: "2020",
    ads: "https://ui.adsabs.harvard.edu/abs/2020AJ....160...78R/abstract",
  },
  {
    title: "Massive Star Formation via the Collapse of Subvirial and Virialized Turbulent Massive Cores",
    authors: "**Rosen, A. L.**, Li, P. S., Zhang, Q., Burkhart, B.",
    venue: "ApJ, 887, 108",
    year: "2019",
    ads: "https://ui.adsabs.harvard.edu/abs/2019ApJ...887..108R/abstract",
  },
  {
    title: "HARM²: A Highly Parallel Method for Radiation Hydrodynamics on Adaptive Grids",
    authors: "**Rosen, A. L.**, Krumholz, M. R., Oishi, J. S., Lee, A. T., Klein, R. I.",
    venue: "Journal of Computational Physics, 330, 924",
    year: "2017",
    ads: "http://adsabs.harvard.edu/abs/2017JCoPh.330..924R",
  },
  {
    title: "An Unstable Truth: How Massive Stars get their Mass",
    authors: "**Rosen, A. L.**, Krumholz, M. R., McKee, C. F., Klein, R. I.",
    venue: "MNRAS, 463, 2553",
    year: "2016",
    ads: "http://adsabs.harvard.edu/abs/2016MNRAS.463.2553R",
  },
];
