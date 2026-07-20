/*
 * teaching.ts — courses, the Cosmic Playground platform, and learner-centered
 * software documentation. Links point to the live course sites (which may move
 * onto this site later). Source: Anna's CV + provided URLs.
 */

import type { PackageStatus, Readiness } from "./jaxstro";

export interface Course {
  code: string;
  title: string;
  blurb: string;
  when: string;
  url?: string | null;
}

export const courses: Course[] = [
  {
    code: "ASTR 596",
    title: "Modeling the Universe",
    blurb:
      "Build glass-box computational models — from stellar dynamics to cosmology — using Python/JAX.",
    when: "Fall 2025",
    url: "https://astrobytes-edu.github.io/astr596-modeling-universe/",
  },
  {
    code: "COMP 536",
    title: "Computational Modeling for Scientists",
    blurb:
      "Think computationally: solve differential equations, fit models to data, and write maintainable scientific code.",
    when: "Spring 2025, 2026",
    url: "https://astrobytes-edu.github.io/comp536-sp26/",
  },
  {
    code: "ASTR 201",
    title: "Astronomy for Science Majors",
    blurb:
      "Observe. Model. Infer. A quantitative approach to decoding what starlight tells us about the universe.",
    when: "Spring 2024, 2025, 2026",
    url: "https://astrobytes-edu.github.io/astr201-sp26/",
  },
  {
    code: "ASTR 101",
    title: "Principles of Astronomy",
    blurb:
      "How do we know what we know? A guided tour of the universe through the lens of scientific reasoning.",
    when: "Spring 2026",
    url: "https://astrobytes-edu.github.io/astr101-sp26/",
  },
  {
    code: "COMP 521",
    title: "Introduction to Computational Science",
    blurb:
      "From scratch to professional practice: numerical methods, data science, and software engineering — all in Python.",
    when: "Fall 2024",
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
