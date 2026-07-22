---
title: "The Lives & Deaths of Star Clusters"
kind: overview
order: 0
status: spec
tagline: "One coherent, choose-your-depth story — ending on how we know any of it."
research: ["progenax", "gravax", "startrax", "fluxax", "informax", "HARM²", "Confidently Wrong"]
---

An **explorable series**: one coherent storyline about how a star cluster — and the
stars inside it — are born, live, and die, told so that reading and playing are the
same act. It doubles as outreach and teaching, and it is built so it can keep growing
for years.

## The spine (a story, not a slideshow)

A single narrative, followed start to finish, but **choose-your-depth**: at any
chapter you may branch into a deep dive and return. Two nested protagonists —
**one cluster** you create and follow to dissolution, and, inside it, **one star** you
follow from ignition to remnant.

**Birth → Census (IMF & HR) → A star's life & death (evolution, winds, remnant) →
The origin of the elements → What fools us (binarity) → Feedback & energetics →
Dynamics → Dissolution → The Observer's Dilemma.**

## The heartbeat

Almost every step is the same interaction: **toggle one physical process, hold the
rest fixed, and watch what changes** — winds on/off, binaries on/off, gravity
isolated/N-body, feedback on/off, metallicity hi/lo. That toggle *is* the scientific
method, and it is the reusable primitive the shared kit provides once, so every page
inherits it. Its deepest use is the **theory ↔ observation** toggle — the latent truth
versus what a telescope delivers — which is the pedagogical thesis of the whole series:
astronomy needs both, and most people never see the seam. The spine of the *story* is
**observe → model → infer**.

## The architecture, in one line

Every chapter is one physics object seen along two axes — **Depth** (Story / Inspect /
Derive) and **Face** (Theory / Observation) — reading a single `star(M, Z, t)` contract
over one canonical cluster. The load-bearing design (the contract, the model ladder, the
one-cluster state, the `observe()` seam) lives in **[Architecture](/explore-plan/01-architecture)**.

## Story pages vs interactive pages

Two layers, deliberately separate:

- **Story pages** — the chapters: readable narrative + a light inline taste.
- **Interactive pages** — standalone tools (IMF sampler, HR inspector, stellar tracks,
  winds lab, N-body, elements, synthetic observatory, the reckoning). Chapters **link
  off** to them. Tools are reusable across chapters and deep dives, and linkable on
  their own (a teacher can assign one directly).

## A constellation, not a syllabus

The scope is large on purpose. Nobody has to read 1–12 in order: the grand tour is one
obvious door, but the chapters are interconnected nodes with several **paths** through
them (life cycle · the cluster as a system · the observer · one massive star · Confidently
Wrong), a **field notebook** that remembers your cluster, and staged **arcs** that ship one
complete piece at a time. The full navigation grammar is in
**[Navigation](/explore-plan/03-navigation)**; the persistent cluster it all hangs on is in
**[Cluster state](/explore-plan/02-cluster-state)**.

## The ending — "The Observer's Dilemma"

The series lets the reader do what no astronomer can: watch one cluster live its whole
life. The finale takes that away and hands back only what a telescope delivers — a
**mock image and a reddened color-magnitude diagram** (synthesised with **fluxax**,
the Sim2SKIRT lineage), at a single frozen instant of a Myr–Gyr life. Now *infer the
truth back*, and meet the degeneracies that make it **confidently wrong**. And because
one cluster is a single frame of a billion-year movie you can never replay, the reader
confronts why real astrophysics must **observe thousands of clusters at every age and
stitch the snapshots into a life**. That is how we know any of this — and it is what
**informax** is for.

## Modelling & honesty

Physics climbs a ladder without the UI noticing: **now** the validated ZAMS core (Tout
1996) plus Hurley's `t_MS` as a lifetime clock; **later** precomputed **startrax** tracks
and remnants, **gravax** N-body, **fluxax** synthetic observations, **progenax** natal gas,
all produced offline and read in the browser; **last** a differentiable surrogate where —
and only where — a continuous slider demands it. The site *consumes* the codes' output and
never re-derives their physics, so every page can say "this *is* startrax." Every page
carries a provenance line and an "illustrative, not an evolution run" label; nothing is
invented. Full detail in **[Architecture](/explore-plan/01-architecture)**.

**Theory first.** The current build is the pure-theory chain; `observe()` (the fluxax
observation face) is deferred, with only its free foundation pre-wired — see the
architecture's `observe()` seam.

## Build approach

The shared kit is built once; the series grows in **arcs**, one complete piece at a time,
starting with **Arc I — Birth & census** (the IMF + HR inspector already built and validated
this session). The release rule is that every shipped arc feels complete enough to invite the
next return — see **[Navigation](/explore-plan/03-navigation)** for the arc plan. Curated
**tours** — outreach / undergrad / research — cut different depths; **paths** cut different
routes; the two are orthogonal.

*This whole section is a dev-only planning surface. It is never built into the public
site.*
