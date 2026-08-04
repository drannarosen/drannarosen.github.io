/*
 * /news — a dated log of announcements, press and features.
 *
 * Every item here was ported from the WordPress site this replaced, read from
 * the Internet Archive's 2020-10-30 capture of anna-rosen.com/news/. The text
 * is Anna's own, lightly corrected for two typos ("lead by" -> "led by", a
 * missing space in one date); no item was reworded, and none was invented.
 *
 * WHY A LOG AND NOT A "NEWS" PAGE IN THE USUAL SENSE: /now says what I am
 * working on and gets rewritten. This is append-only and always dated, so a
 * gap in it reads as a gap in the record rather than as an abandoned site.
 *
 * LINK ROT: every outbound URL was checked on 2026-08-04. Three of the
 * originals were dead and now point at the program's own page instead of the
 * story that covered it — marked `linkNote` so the substitution is visible
 * here rather than being silently absorbed. The rest resolve as written,
 * except Astronomy Magazine and Sky & Telescope, which moved and are recorded
 * at their current URLs.
 */

export type NewsLink = {
  readonly label: string;
  readonly href: string;
};

export type NewsItem = {
  /** ISO date, for sorting and <time datetime>. */
  readonly date: string;
  /** As displayed. */
  readonly displayDate: string;
  readonly body: string;
  readonly links: readonly NewsLink[];
  /** Set when a link differs from the original because the original died. */
  readonly linkNote?: string;
};

export const news: readonly NewsItem[] = [
  {
    date: "2020-09-04",
    displayDate: "September 4, 2020",
    body: "Our paper “Winds in Star Clusters Drive Kolmogorov Turbulence”, led by Monica Gallegos-Garcia (graduate student at Northwestern), has been featured on astrobites, a site sponsored by the AAS that summarizes astronomy research papers for a broad audience.",
    links: [
      {
        label: "Paper on ADS",
        href: "https://ui.adsabs.harvard.edu/abs/2020ApJ...899L..30G/abstract",
      },
      {
        label: "astrobites summary",
        href: "https://astrobites.org/2020/09/04/a-windy-day-in-the-milky-way/",
      },
    ],
  },
  {
    date: "2020-07-09",
    displayDate: "July 9, 2020",
    body: "I was interviewed by Astronomy Magazine for their article “The Sun’s Lost Siblings.”",
    links: [
      {
        label: "Astronomy Magazine article",
        href: "https://www.astronomy.com/observing/astronomers-think-they-can-find-the-suns-lost-siblings/",
      },
    ],
    linkNote: "Astronomy Magazine restructured its site; recorded at its current URL.",
  },
  {
    date: "2020-07-06",
    displayDate: "July 6, 2020",
    body: "Our paper “The Role of Outflows, Radiation Pressure, and Magnetic Fields in Massive Star Formation” has been featured on astrobites, a site sponsored by the AAS that summarizes astronomy research papers for a broad audience.",
    links: [
      { label: "Paper on arXiv", href: "https://arxiv.org/abs/2006.04829" },
      {
        label: "astrobites summary",
        href: "https://astrobites.org/2020/07/06/the-formation-of-massive-stars/",
      },
    ],
  },
  {
    date: "2020-05-20",
    displayDate: "May 20, 2020",
    body: "I had the honor to give an interview about my research for #astrochats, hosted by Erika Wright of the Micro Observatory.",
    links: [
      {
        label: "My astrochats interview",
        href: "https://www.youtube.com/watch?v=JEOY4z0KgAU",
      },
      { label: "@MicroObs", href: "https://x.com/MicroObs" },
    ],
  },
  {
    date: "2017-02-15",
    displayDate: "February 15, 2017",
    body: "I will be joining the Harvard-Smithsonian Center for Astrophysics next fall as a joint Einstein-ITC Postdoctoral Fellow.",
    links: [
      {
        label: "NASA Hubble Fellowship Program",
        href: "https://www.stsci.edu/stsci-research/fellowships/nasa-hubble-fellowship-program",
      },
    ],
    linkNote:
      "The original linked a HubbleSite press release announcing the 2017 Einstein, Hubble and Sagan Fellows; hubblesite.org was retired and that release no longer resolves. This links the program's current home instead.",
  },
  {
    date: "2017-01-27",
    displayDate: "January 27, 2017",
    body: "My talk from the 229th AAS Meeting, which featured my work on massive star formation, has been featured on Sky & Telescope.",
    links: [
      {
        label: "Sky & Telescope article",
        href: "https://skyandtelescope.org/astronomy-news/massive-stars-grow-finger-food/",
      },
    ],
    linkNote: "Sky & Telescope moved from .com to .org; recorded at its current URL.",
  },
  {
    date: "2016-11-11",
    displayDate: "November 11, 2016",
    body: "I won the AAS Rodger Doxsey Travel Prize. The award provides travel support to the 2017 AAS Winter meeting in Grapevine, Texas, where I will be presenting my dissertation research.",
    links: [
      {
        label: "Rodger Doxsey Travel Prize",
        href: "https://aas.org/grants-and-prizes/rodger-doxsey-travel-prize",
      },
    ],
  },
  {
    date: "2016-09-20",
    displayDate: "September 20, 2016",
    body: "I received an ARCS Foundation fellowship.",
    links: [{ label: "ARCS Foundation", href: "https://arcsfoundation.org/" }],
    linkNote:
      "The original linked a UC Santa Cruz news story that did not survive that site's redesign. This links the foundation instead.",
  },
  {
    date: "2016-07-15",
    displayDate: "July 15, 2016",
    body: "Our massive star formation work has been featured on New Scientist.",
    links: [
      {
        label: "New Scientist article",
        href: "https://www.newscientist.com/article/2097654-baby-stars-grow-big-and-strong-by-eating-their-own-burst-bubbles/",
      },
    ],
  },
  {
    date: "2016-07-01",
    displayDate: "July 1, 2016",
    body: "I received an American Association of University Women (AAUW) American Dissertation Fellowship.",
    links: [
      {
        label: "AAUW Fellowships & Grants",
        href: "https://www.aauw.org/resources/programs/fellowships-grants/",
      },
      {
        label: "UC Santa Cruz story",
        href: "https://news.ucsc.edu/2016/08/aauw-fellowships.html",
      },
    ],
    linkNote:
      "The original linked an AAUW awardee-directory entry that no longer resolves. This links the program instead; the UC Santa Cruz story is the original link and still works.",
  },
];
