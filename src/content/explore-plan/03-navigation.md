---
title: "Navigation — a constellation, not a syllabus"
kind: overview
order: 3
status: spec
tagline: "One grand tour, many paths, staged arcs, a field notebook — the large scope made navigable."
research: ["Confidently Wrong"]
---

The scope is deliberately large. The job is not to shrink it but to make it **navigable and
alive**: a place people return to through different doors, not a page they finish once. This
is the navigation grammar that lets everything in the series coexist without any single page
becoming chaotic.

## One grand tour, always

A first-time visitor gets one obvious entrance — **Take the grand tour: The Lives & Deaths of
Star Clusters** — which carries them through the whole physical *and* epistemological arc in
order. The linear spine (Overview) is that tour. It always exists; everything else is optional
sideways motion.

## Paths — the constellation

Beyond the linear tour, the chapters are **interconnected nodes** with several valid journeys
through them. A **path** is a thematic route; a reader picks the thread that caught them:

- **Life cycle** — cloud → stars → evolution → death → remnants → enrichment.
- **The cluster as a system** — birth → dynamics → mass segregation → gas loss → dissolution.
- **The observer** — true population → telescope → biases → inference → uncertainty.
- **One massive star** — O star → winds → feedback → supernova → remnant → elements.
- **Confidently Wrong** — IMF sampling → unresolved binaries → incompleteness → naive fitting
  → wrong answer.

**Paths are orthogonal to tours.** *Tours* (outreach / undergrad / research) set the *depth*;
*paths* set the *route*. A reader travels one path at whatever depth their tour implies.

*Mechanism (deferred):* when we build the map, `arc` and `paths` become optional frontmatter
on each node, so the constellation is **derived from the records**, not hand-drawn — the same
one-source-of-truth discipline as everywhere else. Not added to the schema yet (no premature
machinery); documented here so the tagging is intentional when it lands.

## Two exits per chapter

Every chapter ends as a launch point, not a dead end — **continue the story** *and* **follow
your curiosity**. After "The Stars Fight Back," say: continue to dynamics · follow one star
through its life · explore the IMF · (later) see what a telescope would measure · ask why the
massive stars formed near the center. Each exit is a link to a node or engine; the reader
never hits a wall.

## Four modes = the two axes, named for readers

The reader-facing "modes" are just positions on the two axes in
**[Architecture](/explore-plan/01-architecture)** — same vocabulary, friendlier labels, no
forked terminology:

| Mode | Axis position | Feel |
| --- | --- | --- |
| **Story** | Depth = Story | cinematic, minimal controls (the current Birth page) |
| **Lab** | Depth = Inspect | sliders, plots, comparisons |
| **Notebook** | Depth = Derive | equations, assumptions, references, provenance |
| **Observatory** | Face = Observation | synthetic data + inference *(deferred)* |

Preserving the cinematic Story mode for the spine, then letting visitors step sideways into
Lab / Notebook / Observatory, is how the site covers everything without every page turning
into a dashboard.

## The Explore landing = a visual map

The landing page is a **map of the whole system**, showing both the linear story and the
network of causes:

> cloud → population → stars → feedback → cluster → telescope → inference

with cross-links everywhere — IMF ↔ binaries, winds ↔ feedback, remnants ↔ dynamics,
dissolution ↔ observability, telescope ↔ inference, and uncertainty ↔ every chapter. A reader
sees the spine *and* the constellation at once, and can enter anywhere.

## The field notebook (observing log)

Persistent state (see **[Cluster state](/explore-plan/02-cluster-state)** — the `Log`) turns
into ownership. Not childish badges; a **scientific record** in the site's own voice:

> **Your observing log** · Cluster mass 10⁴ M☉ · Age explored 1–100 Myr · Selected star 37 M☉
> · Naive IMF slope −1.9 · Corrected slope −2.31 · Deep dives unlocked: 2

Most of it is *derived* from current state (cluster mass, the selected star's properties at
the current `t`); only a small event log (chapters visited, milestones, inferences run) is
genuinely stored. Later pages can then say real things — "your cluster formed 11 O stars,"
"the star you followed has lost 18% of its mass," "your naive IMF estimate is biased high."

## Staged release — arcs, shown openly

The vision covers everything; the *implementation* ships in expanding **arcs**, and the site
openly shows what is coming (which itself invites return):

- **Arc I — Birth & census** · Birth of a Cluster, IMF Sampler, HR Inspector.
- **Arc II — Lives & deaths** · Stellar Tracks, Winds, Remnants, Elements.
- **Arc III — A cluster is a system** · Feedback, dynamics, segregation, dissolution.
- **Arc IV — What the telescope sees** · Synthetic Observatory, binaries, selection effects.
- **Arc V — How we know** · Inference Reckoning, model misspecification, Confidently Wrong.

The release rule: **every shipped piece must feel complete enough to invite the next return.**
We do not wait for all twelve chapters — we ship Arc I whole, then grow. This supersedes the
looser "build approach" note in the Overview.
