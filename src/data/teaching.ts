/*
 * teaching.ts — courses, the Cosmic Playground platform, and learner-centered
 * software documentation. Links point to the live course sites (which may move
 * onto this site later). Source: Anna's CV + provided URLs.
 */

import type { PackageStatus, Readiness } from "./jaxstro";

/*
 * Terms are structured, not free text, because /now needs to answer "is this
 * happening?" and a string cannot be asked. The page previously took the first
 * two courses in array order and called them current, which in July 2026 meant
 * announcing two semesters that had already ended. Order is not a calendar.
 *
 * `when` is DERIVED from these (see termLabel) so the displayed string and the
 * date logic can never disagree — the failure that would otherwise replace the
 * one being fixed.
 */
export type Season = "spring" | "summer" | "fall";

export interface Term {
  season: Season;
  year: number;
}

/* Approximate SDSU term boundaries as day-of-year windows. Approximate is
   enough: this decides which of three coarse buckets today falls in, never
   anything a reader could check against a registrar calendar. */
const TERM_WINDOW: Record<Season, { from: [number, number]; to: [number, number] }> = {
  spring: { from: [1, 15], to: [5, 20] },
  summer: { from: [5, 21], to: [8, 15] },
  fall: { from: [8, 16], to: [12, 20] },
};

const SEASON_LABEL: Record<Season, string> = {
  spring: "Spring",
  summer: "Summer",
  fall: "Fall",
};

const SEASON_ORDER: Season[] = ["spring", "summer", "fall"];

/** UTC midnight for a term boundary, so the label never shifts by timezone. */
const boundary = (year: number, [month, day]: [number, number]) =>
  Date.UTC(year, month - 1, day);

export const termStart = (t: Term) => boundary(t.year, TERM_WINDOW[t.season].from);
export const termEnd = (t: Term) => boundary(t.year, TERM_WINDOW[t.season].to);

/** True while the term is running. */
export const termIsCurrent = (t: Term, now: Date) =>
  now.getTime() >= termStart(t) && now.getTime() <= termEnd(t);

/**
 * "Fall 2025", or "Spring 2024, 2025, 2026" — years collapse under one season,
 * which is how the strings were hand-written before they were derived.
 */
export function termLabel(terms: Term[]): string {
  const bySeason = new Map<Season, number[]>();
  for (const t of terms) {
    const years = bySeason.get(t.season) ?? [];
    years.push(t.year);
    bySeason.set(t.season, years);
  }
  return SEASON_ORDER.filter((s) => bySeason.has(s))
    .map((s) => {
      const years = [...new Set(bySeason.get(s))].sort((a, b) => a - b);
      return `${SEASON_LABEL[s]} ${years.join(", ")}`;
    })
    .join(" · ");
}

export interface Course {
  code: string;
  title: string;
  blurb: string;
  terms: Term[];
  url?: string | null;
}

/** Display string for a course's terms. Derived — never authored. */
export const courseWhen = (c: Course) => termLabel(c.terms);

/**
 * Which season today falls in, or null in the gap between terms.
 *
 * Summer is not a teaching term, so "no courses this term" is the wrong
 * sentence for it — there is no term to have no courses in. Callers use this
 * to say what is actually true of the month they are in.
 */
export function seasonOf(now: Date): Season | null {
  const year = new Date(now.getTime()).getUTCFullYear();
  return (
    SEASON_ORDER.find((season) => termIsCurrent({ season, year }, now)) ?? null
  );
}

/** Courses running right now, most recent term first. */
export const coursesNow = (list: Course[], now: Date): Course[] =>
  list.filter((c) => c.terms.some((t) => termIsCurrent(t, now)));

/** The soonest course that has not started yet, if any is on the books. */
export function nextCourse(list: Course[], now: Date): { course: Course; term: Term } | null {
  const upcoming = list
    .flatMap((c) => c.terms.map((term) => ({ course: c, term })))
    .filter(({ term }) => termStart(term) > now.getTime())
    .sort((a, b) => termStart(a.term) - termStart(b.term));
  return upcoming[0] ?? null;
}

export const courses: Course[] = [
  {
    code: "ASTR 596",
    title: "Modeling the Universe",
    blurb:
      "Build glass-box computational models — from stellar dynamics to cosmology — using Python/JAX.",
    terms: [{ season: "fall", year: 2025 }],
    url: "https://astrobytes-edu.github.io/astr596-modeling-universe/",
  },
  {
    code: "COMP 536",
    title: "Computational Modeling for Scientists",
    blurb:
      "Think computationally: solve differential equations, fit models to data, and write maintainable scientific code.",
    terms: [
      { season: "spring", year: 2025 },
      { season: "spring", year: 2026 },
    ],
    url: "https://astrobytes-edu.github.io/comp536-sp26/",
  },
  {
    code: "ASTR 201",
    title: "Astronomy for Science Majors",
    blurb:
      "Observe. Model. Infer. A quantitative approach to decoding what starlight tells us about the universe.",
    terms: [
      { season: "spring", year: 2024 },
      { season: "spring", year: 2025 },
      { season: "spring", year: 2026 },
    ],
    url: "https://astrobytes-edu.github.io/astr201-sp26/",
  },
  {
    code: "ASTR 101",
    title: "Principles of Astronomy",
    blurb:
      "How do we know what we know? A guided tour of the universe through the lens of scientific reasoning.",
    terms: [{ season: "spring", year: 2026 }],
    url: "https://astrobytes-edu.github.io/astr101-sp26/",
  },
  {
    code: "COMP 521",
    title: "Introduction to Computational Science",
    blurb:
      "From scratch to professional practice: numerical methods, data science, and software engineering — all in Python.",
    terms: [{ season: "fall", year: 2024 }],
    url: null,
  },
];

export interface LearningResource {
  name: string;
  blurb: string;
  url: string;
  kind: string;
  /*
   * Development status, shown with the same badge + meter as /software. These
   * are built things, not finished products, and the page should say so rather
   * than let a link imply a release. Values are Anna's to set — see the note
   * in jaxstro.ts on why readiness, not status, is what differs.
   */
  status?: PackageStatus;
  readiness?: Readiness;
  /** Free-text maturity note, e.g. "Pilot course running". */
  maturity?: string;
}

export const learningResources: LearningResource[] = [
  {
    name: "Sophie",
    kind: "Authoring platform",
    blurb:
      "A schema-driven, AI-authorable platform for interactive textbooks, course sites and slides — one lesson, many accessible outputs.",
    url: "https://github.com/drannarosen/sophie",
    status: "active-build",
    readiness: "advanced",
    maturity: "Active development · not yet released for external use",
  },
  {
    name: "Cosmic Playground",
    kind: "Interactive platform",
    status: "active-build",
    readiness: "advanced",
    blurb:
      "Predict. Play. Explain. — an interactive astronomy demos platform. Play with the universe; learn the physics.",
    url: "https://astrobytes-edu.github.io/cosmic-playground/",
  },
  {
    name: "jaxstro documentation",
    kind: "Learner-centered docs",
    blurb:
      "Theory chapters, tutorials, and a glossary written so a first-year graduate student and a professor can both use the software.",
    url: "https://jaxstro.github.io/jaxstro/",
  },
  {
    name: "progenax documentation",
    kind: "Learner-centered docs",
    blurb:
      "Guided documentation for building truth-known cluster birth populations with differentiable IMFs and structure.",
    url: "https://jaxstro.github.io/progenax/",
  },
];
