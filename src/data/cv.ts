/*
 * cv.ts — structured CV data (source: Anna's maintained Typst CV).
 * The /cv page renders entirely from this module. Kept curated, not
 * exhaustive: the full record lives in the downloadable PDF. Nothing here is
 * invented — every entry traces to the CV.
 */

import { refereedCount } from "./allPublications";

export interface DatedEntry {
  role: string;
  org?: string;
  date: string;
  note?: string;
  /** Optional link for the note (e.g. the ADS record for a thesis). */
  href?: string;
  /** Optional link for the role itself (e.g. a course's public site). */
  roleHref?: string;
}

export interface Publication {
  title: string;
  authors: string; // Anna's name wrapped in **bold** for emphasis
  venue: string;
  year: string;
  ads?: string | null;
  status?: "submitted" | "accepted" | null;
}

export interface Advisee {
  name: string;
  affiliation: string;
  date: string;
  project?: string;
  /** Project or contribution led to a refereed publication (★ in the CV). */
  refereed?: boolean;
  /** Degree programme, e.g. "M.S. Astronomy". Shown on /now, not on the CV. */
  program?: string;
  /** When they are due to finish, e.g. "Summer 2026". Drives the /now list. */
  finishing?: string;
}

/**
 * Advisees due to finish, for /now.
 *
 * Marked explicitly rather than inferred from an open-ended date, because
 * "currently advised" and "about to graduate" are different facts and only
 * one of them belongs under a heading that says so.
 *
 * Derived from the CV record either way, so the two pages cannot disagree:
 * closing out a student on the CV removes them from /now in the same edit.
 * Naming them in prose on /now instead is how a page ends up still announcing
 * a defence that happened two years ago.
 */
export const finishingAdvisees = (people: Advisee[]) => people.filter((a) => a.finishing);

export interface Grant {
  role: string;
  program: string;
  title: string;
  date: string;
}

export const cvProfile = {
  name: "Anna Lorraine Rosen, Ph.D.",
  role: "Computational Astrophysicist",
  title: "Assistant Professor of Astronomy, San Diego State University",
  orcid: "https://orcid.org/0000-0003-4423-0660",
  /**
   * Compiled from Anna's Typst CV, which is the complete record — this module
   * is a curated subset. Rebuild with `pnpm cv:pdf`.
   */
  pdf: "/documents/cv-anna-rosen.pdf" as string | null,
  stats: [
    // Derived from the ORCID sync so it can't drift out of date. Refereed count
    // (journal articles), matching the printed CV's headline.
    { value: String(refereedCount), label: "Publications" },
    { value: "55", label: "Invited talks" },
    { value: "18", label: "Students advised" },
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
  {
    role: "Ph.D., Astronomy & Astrophysics",
    org: "UC Santa Cruz",
    date: "2017",
    note: "Thesis: The Destructive Birth of Massive Stars & Massive Star Clusters",
    href: "https://ui.adsabs.harvard.edu/abs/2017PhDT.......182R/abstract",
  },
  { role: "M.S., Astronomy & Astrophysics", org: "UC Santa Cruz", date: "2012" },
  { role: "B.A., Physics & Astrophysics (double major)", org: "UC Berkeley", date: "2009" },
  { role: "Community College Transfer Student", org: "Los Angeles Pierce College", date: "2007" },
];

/** Full award list, as in the CV. */
export const awards: DatedEntry[] = [
  { role: "Assigned Time for Research (Fall 2026)", org: "SDSU Division of Research & Innovation", date: "2026", note: "gravax: Population-Scale Star Cluster Inference with Differentiable Dynamics" },
  { role: "ATHENA Faculty Champion", org: "SDSU", date: "2024", href: "https://www.athenastemwomen.org/" },
  { role: "DRI GREW Fellowship", org: "Division of Research & Innovation, SDSU", date: "Fall 2024" },
  { role: "Rodger Doxsey Dissertation Prize", org: "American Astronomical Society", date: "2017" },
  { role: "ARCS Foundation Fellowship", date: "2016" },
  { role: "AAUW American Dissertation Year Fellowship", date: "2016" },
  { role: "Excellence in Mentoring Award", org: "UC Santa Cruz Astronomy Department", date: "2015" },
  { role: "AAS International Travel Grant", date: "2014, 2016, 2017" },
  { role: "NSF Graduate Research Fellowship Program", date: "2011" },
  { role: "Daniel Edward Wark Memorial Scholarship", org: "UC Berkeley", date: "2009" },
  { role: "NASA Minority Initiatives Internship", org: "NASA JPL", date: "2008" },
  { role: "NASA MUST Internship", org: "NASA JPL", date: "2008" },
  { role: "NASA MUST Scholarship", date: "2007–2008" },
  { role: "NSF REU Internship", org: "UC Davis Physics Department", date: "2007" },
  { role: "Alexander Frolich Award", org: "Los Angeles Pierce College", date: "2007" },
  { role: "NASA JPL Undergraduate Scholars Award", org: "Los Angeles Pierce College", date: "2007" },
  { role: "Thomas McCutcheon Award", org: "Los Angeles Pierce College", date: "2006" },
];

/** Selected first-author publications; the full synced list is on /publications. */
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


/* ---------------------------------------------------------------------------
 * Everything below is transcribed from Anna's Typst CV (the complete record).
 * Nothing here is inferred or summarised — if it is not in the CV, it is not
 * here. Rebuild the PDF with `pnpm cv:pdf` after editing the Typst source.
 * ------------------------------------------------------------------------- */

/** Total obtained as PI, per the CV. */
export const grantTotalPI = "$174,825";

export const grants: Grant[] = [
  {
    role: "Co-I",
    program: "Chandra Observation, Cycle 21 (awarded 100 ks)",
    title:
      "A Super Star Cluster is Born: Probing the X-ray Emission of H72.97-69.39 in LMC-N79",
    date: "2019",
  },
  {
    role: "PI",
    program: "Chandra Theory, Cycle 16",
    title:
      "To Leak or Not to Leak: Where are the Missing X-ray Photons from Massive Star Clusters?",
    date: "2014",
  },
  {
    role: "PI",
    program: "Hubble Archival, Cycle 21",
    title: "Simulating the Birth of Massive Star Clusters: Is Destruction Inevitable?",
    date: "2013",
  },
];

export const graduateAdvisees: Advisee[] = [
  { name: "Surinder Singh Chhabra", affiliation: "Masters Student, SDSU", finishing: "Summer 2026", date: "2025–Present", project: "ORBIT-RAG: Orchestrated Retrieval with Balanced Iteration & Termination for Astrophysics Research" },
  { name: "Aisling Ascuna", affiliation: "Masters Student, SDSU", finishing: "Summer 2026", date: "2024–Present", project: "Lead Developer, Sim2SKIRT: an RMHD simulation-to-synthetic-observation pipeline with SKIRT, applied to STARFORGE star cluster formation simulations" },
  { name: "Zoe Bozich", affiliation: "Masters Student, SDSU", date: "2023–2024", project: "Modeling the Evolution of Accreting Protostars with MESA" },
  { name: "Paarmita Pandey", affiliation: "PhD Student, OSU", date: "2022–Present", project: "Fermi Observations of the Diffuse γ-ray Emission of Young Massive Star Clusters", refereed: true },
  { name: "Jennifer Rodriguez", affiliation: "PhD Student, OSU", date: "2022–Present", project: "Tracing the Impact of Stellar Wind Feedback in N79 & 30 Doradus in the LMC with Chandra", refereed: true },
  { name: "Sabrina Appel", affiliation: "PhD Student, Rutgers; Postdoc, AMNH", date: "2020–2023", project: "Effects of B-fields and Feedback on the Shape and Evolution of the Density PDF in Star Formation", refereed: true },
  { name: "Grace Olivier", affiliation: "PhD Student, OSU; Postdoc, Texas A&M", date: "2020–2023", project: "Evolution of Stellar Feedback in H II Regions", refereed: true },
  { name: "Michael Foley", affiliation: "PhD Student, Harvard", date: "2018–2019", project: "Blowing Bubbles around Intermediate-Mass Stars: Stellar Wind Feedback is not Enough" },
  { name: "Hope Chen", affiliation: "PhD, Harvard; Postdoc, UT Austin", date: "2018–2019", project: "Effects of an Embedded B-Star Wind in Ophiuchus" },
];

export const undergraduateAdvisees: Advisee[] = [
  { name: "Victor Del Rio", affiliation: "SDSU", date: "Summer 2025", project: "STARTAstro Program (community-college transfer student)" },
  { name: "Edwin Sarabia", affiliation: "SDSU", date: "Summer 2025", project: "STARTAstro Program (community-college transfer student)" },
  { name: "Alex Escamilla", affiliation: "SDSU", date: "2024–2026", project: "Bridging Theory and Observation: Synthetic FIR Insights into Star Formation Efficiency", refereed: true },
  { name: "Kate Gonzalez", affiliation: "SDSU", date: "2024", project: "Initial developer of the Sim2SKIRT synthetic-observation pipeline with SKIRT" },
  { name: "Trinity Webb", affiliation: "OSU", date: "2023–2024", project: "Tracing the Impact of Stellar Wind Feedback in N79 & 30 Doradus in the LMC with Chandra", refereed: true },
  { name: "Mikayla Wilson", affiliation: "grad student, UCSC; Banneker Intern, Harvard", date: "2020", project: "Tracing the Evolution of Molecular Outflows in Massive Star Formation with Synthetic Observations" },
  { name: "Monica Gallegos-Garcia", affiliation: "grad student, Northwestern; Banneker Intern, Harvard", date: "2018–2020", project: "Winds in Star Clusters Drive Kolmogorov Turbulence", refereed: true },
  { name: "Courtney Bishop", affiliation: "College of William & Mary; SAO NSF REU", date: "2018", project: "Comparing Molecular Line Tracers in Outflows Generated by Massive Star Formation" },
  { name: "Evan Carter", affiliation: "UCSC; astro masters, Wesleyan", date: "2014–2016", project: "Synthetic Observations of Low-Mass Star Formation: Implications for Current SED-Fitting Methods" },
];

export const serviceSDSU: DatedEntry[] = [
  { role: "Curriculum Committee", date: "2024–Present" },
  { role: "UCSD–SDSU Joint Astronomy Colloquium", date: "2024–Present" },
  { role: "SOC Member, Ensenada–San Diego Astronomical Meeting", date: "2024" },
  { role: "Executive Committee Member, STARTastro Program (NSF-funded)", date: "2024–Present" },
  { role: "Cal-Bridge CSU Physics & Astronomy Mentor", date: "2024–Present", href: "https://calbridge.org/" },
];

export const serviceNational: DatedEntry[] = [
  { role: "NASA JWST Cycle 5 Panelist", date: "2026" },
  { role: "Reviewer, NASA FINESST Graduate Fellowship Program", date: "2025" },
  { role: "Reviewer, NASA Postdoctoral Fellowship Program", date: "2024" },
  { role: "Reviewer & Panelist, NSF Career Award (Astronomical Sciences Div.)", date: "2023" },
  { role: "Co-Editor, Frontiers in Astronomy and Space Sciences", org: "Research Topics collection on Star Formation: Numerical Simulations and What They Teach Us", date: "2023–2024" },
  { role: "SOC co-chair, Olympian Symposium 2023: Star Formation in the Era of JWST", date: "2022–2023", href: "https://olympiansymposium.org/" },
  { role: "Science Working Group Member, PRIMA Far-IR Probe Mission Concept", date: "2022–" },
  { role: "NASA JWST Cycle 1 Panelist", date: "2021" },
  { role: "Referee for A&A, ApJ, MNRAS & RAA", date: "" },
];

export const serviceEarlier: DatedEntry[] = [
  { role: "Harvard Astronomy DEI Committee", date: "2021–2022" },
  { role: "CfA-IDEA Committee", date: "2020–2021" },
  { role: "Organizer, CfA Galaxies & Cosmology Seminar", date: "2019–2021" },
  { role: "Panelist, NASA Theory Astrophysics Program", date: "2019" },
  { role: "Reviewer, NASA NESSF", date: "2019" },
  { role: "Organizer, Equity & Inclusion Journal Club, Harvard–Smithsonian CfA", date: "2018–2019" },
  { role: "Proposal Reviewer, Czech Science Foundation", date: "2018" },
  { role: "ITC Postdoctoral Fellowship Committee Member, Harvard–Smithsonian CfA", date: "2017" },
  { role: "SOC/LOC Member (Chair 2019), Harvard–Heidelberg Star Formation Meeting, CfA", date: "2017, 2019" },
  { role: "Organizer, Diverse Topics in Astronomy Lecture Series, Lamat REU, UCSC", date: "2015, 2016" },
  { role: "Organizer, Space Telescope Proposal Writing Workshop, UCSC Astro. Dept.", date: "2015" },
  { role: "Member, LAMAT Research Internship Admissions Committee", date: "2014" },
  { role: "Undergraduate Student Mentor, UCSC Women in Physics Group", date: "2013–2017" },
  { role: "Graduate Student Mentor, UCSC Astro. & Astrophys. Dept.", date: "2012–2013, 2016–2017" },
  { role: "Astronomy Grad Student Representative, UCSC GSA", date: "2012–2013" },
  { role: "Organizer, Applying to the NSF GRFP Workshop, UCSC Astro. Dept.", date: "2012–2016" },
];

/** Counts from the CV's presentations callout. */
export const talkCounts = { invited: 55, contributed: 36 };

export const selectedTalks: DatedEntry[] = [
  { role: "Invited Talk, Star Formation, Stellar Feedback, and the Ecology of Galaxies", org: "Visegrád, Hungary", date: "2025" },
  { role: "Invited Talk, TOSCA — Topical Overview on Star Cluster Astrophysics", org: "Siena, Italy", date: "2024" },
  { role: "Invited Talk, The Fullness of Space: Celebrating the Career of Christopher F. McKee", org: "Berkeley, CA", date: "2024" },
  { role: "Invited Colloquium, Simons Center for Computational Astrophysics", org: "New York, NY", date: "2024" },
  { role: "Keynote Speaker, Cal Poly Pomona Annual Women in Physics Seminar", org: "Pomona, CA", date: "2024" },
  { role: "Invited Colloquium, University of Indiana Astronomy Colloquium", date: "2024" },
  { role: "Invited Talk, Resolving Galaxy Ecosystems Across All Scales", org: "Sha Tin, Hong Kong", date: "2023" },
  { role: "Invited Colloquium, Johns Hopkins University / STScI", org: "Baltimore, MD", date: "2023" },
  { role: "Invited Keynote, Science with the Line Emission Mapper", org: "Harvard–Smithsonian CfA", date: "2023" },
  { role: "Invited Talk, IAU Challenges & Innovations in Computational Astrophysics", date: "2022" },
  { role: "Invited Colloquium, Durham University Astronomy Department", org: "Durham, UK", date: "2022" },
  { role: "Invited Colloquium, Caltech Astronomy Colloquium", org: "Pasadena, CA", date: "2021" },
  { role: "Invited Colloquium, Royal Observatory of Edinburgh", org: "Edinburgh, Scotland", date: "2021" },
  { role: "Invited Review Talk, Radiation Hydrodynamics: Implementation & Application", org: "RAS, London, UK", date: "2020" },
  { role: "Invited Review Talk, ISSI Star Formation Workshop", org: "Bern, Switzerland", date: "2019" },
  { role: "Invited Talk, Gas Fueling of Galaxy Structures, Astro 3D", org: "Barossa Valley, Australia", date: "2018" },
];

export const outreach: DatedEntry[] = [
  { role: "Speaker, Sharp Minds Public Lecture Series", org: "Fleet Science Center, San Diego, CA", date: "2025" },
  { role: "Panelist/Speaker, NASA Community College Symposium", org: "Fleet Science Center, San Diego, CA", date: "2024" },
  { role: "SDSU Astronomy Expert, Solar Eclipse Event", org: "Fleet Science Center, San Diego, CA", date: "2024" },
  { role: "Speaker, “Women and Non-binary in STEM” Series", org: "San Diego Miramar College (SDCCD)", date: "2023" },
  { role: "AAUW STEM Ambassador, STEMEd for Girls program", date: "2022", href: "https://www.aauw.org/resources/programs/stemed-for-girls/" },
  { role: "Speaker, “How to Make Massive Stars on a (super)Computer”", org: "Western Nevada College / NCCN", date: "2022" },
  { role: "Science Matter Expert, NASA Community College Network (NCCN)", date: "2021–Present" },
  { role: "Panelist, Astronomy Career Panel", org: "Girls Inc., Lynn, MA", date: "2021" },
  { role: "Panelist, “Meet a Scientist” for Women’s History Month", org: "Marin Community College", date: "2021" },
  { role: "Interviewee, “How to Make Stars on a (super)Computer”", org: "Astrochats / MicroObservatory", date: "2020", href: "https://youtu.be/JEOY4z0KgAU" },
  { role: "Speaker, “How to Make Massive Stars on a (super)Computer”", org: "Astronomy on Tap Boston", date: "2020" },
  { role: "Presenter, “Visualizing Numerical Simulations with yt”", org: "CfA | Harvard & Smithsonian Demofest", date: "2019" },
  { role: "Speaker, “An Unstable Truth: How Massive Stars get their Mass”", org: "AAUW Monterey Peninsula", date: "2017" },
  { role: "Speaker, “Then and Now: From NHP to a Ph.D. in Astrophysics”", org: "North Hills Prep School", date: "2016" },
  { role: "Astronomy Outreach, Expanding Your Horizons Workshop for Young Girls", org: "Hartnell College", date: "2015" },
  { role: "Speaker, “Computational Astrophysics”", org: "Stanford Pre-collegiate Summer Courses", date: "2015" },
  { role: "Speaker, “Star Formation and Stellar Feedback”", org: "Lamat REU, UCSC", date: "2015, 2016" },
  { role: "Author, astrobites.org", date: "2011–2013", href: "https://astrobites.org/author/annarosen84/" },
  { role: "Panelist, Girl Scouts Girls Go Tech Event", org: "NASA Ames, Moffett Field, CA", date: "2011" },
];

export const professionalDevelopment: DatedEntry[] = [
  { role: "AI Ready Course Design Workshop, SDSU Center for Teaching and Learning", date: "2026" },
  { role: "Diversity & Inclusion Certificate Program, UCSC Office for DEI", date: "2017" },
  { role: "ISEE PDP for Inquiry-based Education, UCSC", date: "2011" },
  { role: "Astronomy 300: Instruction Techniques in General Astronomy, UC Berkeley", date: "2009" },
];
