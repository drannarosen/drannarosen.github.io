# Content integrity & provenance — design

Date: 2026-07-19
Status: approved, not yet implemented

## The decision

The distinguishing feature of this site is not visual polish. It is
**verifiable provenance**: a reader can trace every claim and every figure back
to the data and code that produced it, and can tell how a page was authored.

This became urgent for a specific reason: Anna intends to publish
AI-drafted posts. On a scientist's site that is a reputational hazard by
default — one fabricated number under her name outweighs any amount of design.
Governance infrastructure is what converts the hazard into an asset. The
difference between "Anna lets AI write her posts" and "Anna built a system in
which nothing ships unverified" is entirely in the machinery.

### The bug that motivated this

`/astrobytes/confidently-wrong` serves the **corrected** Figure 4. arXiv serves
the version with the `95\%` rendering bug. The site and the published record
already disagree, and nothing on either page tells a reader so. Today the
difference is a text label. The identical failure mode with a *data* change is
a correctness problem, and there is currently no mechanism that would catch it.

## Scope

**Most of this is not AI.** Only prose drafting involves a model; every gate
below is a deterministic script.

| capability | AI? |
| --- | --- |
| ORCID publication sync | no — API client |
| dead-link / DOI checking | no — HTTP |
| figure-drift detection | no — re-run, compare |
| "every number cites a source" | no — schema validation |
| drafting prose | yes |

### Increment 1 — MDX

Posts are Markdown today, so figures are hand-written raw HTML. Two
consequences already observed: math silently fails inside raw HTML blocks
(`remark-math` only visits Markdown text nodes), and figure markup is
duplicated rather than componentised.

Add `@astrojs/mdx`. Author figures as a real `<Figure>` component with working
math, and keep the `editorial.css` layout classes as its output.

### Increment 2 — provenance

Every post declares how it was authored, and it renders **publicly** on the
page. Anna's call, and the stronger position for someone who teaches
computational methods: showing the guardrails beats silence.

```yaml
provenance:
  authorship: human | ai-drafted | machine-generated
  reviewedBy: "Anna Rosen"      # required unless authorship == human
  reviewedOn: 2026-07-19        # required unless authorship == human
  model: "claude-opus-4-8"      # required when a model was involved
sources:                        # every quantitative claim resolves here
  - id: rosen2026
    url: https://arxiv.org/abs/2603.15779
```

### Increment 3 — CI gates

The build **fails** rather than warns. A warning nobody reads is not a gate.

1. **Review gate** — `authorship != human` and not `draft` requires
   `reviewedBy` + `reviewedOn`. Nothing AI-touched publishes unreviewed.
2. **Link gate** — every external URL, DOI and arXiv id resolves.
3. **Figure-drift gate** — each site figure records the source repo, script and
   commit that produced it; CI verifies the recorded commit still produces a
   byte-identical file. This is the gate that catches the Figure 4 class of bug.

### Increment 4 — machine-readable identity

JSON-LD (`Person`, `ScholarlyArticle`, `SoftwareSourceCode`), per-post Open
Graph images generated at build, RSS, sitemap. Makes the work legible to Google
Scholar, aggregators, and models. Machine-generated posts, if they ever exist,
set JSON-LD `author` to a `SoftwareApplication` — never to Anna.

## Deferred — recorded so the reasoning is not lost

**JAXSTRO changelog (autonomous).** Deferred at Anna's request. Two reasons,
both good: commit volume is AI-assisted and therefore a misleading public
signal — it measures tooling throughput, not scientific progress; and a
changelog serves people who depend on releases, so before there are users it is
a diary. Revisit when the ecosystem has external users or contributors.

**Citation watch, arXiv digest, reproducibility reports.** Same machinery,
later.

**Autonomous publishing.** Not now. When revisited, the ladder is:

- **b1** — generate on a cron, open a PR, human merges. Same shape as the
  existing ORCID sync; no new risk class.
- **b2** — publish to a segregated, visibly-labelled machine stream on its own
  route, excluded from Anna's authored RSS and JSON-LD.
- **b3** — publish unreviewed under Anna's name. Never.

Promotion from b1 to b2 must be **earned**: roughly ten merged instances of a
given content type with no edits required.

Governing principle: **autonomy scales inversely with how much the content
characterises someone else's science.** Summarising Anna's own artifacts is
checkable against a commit. Summarising a colleague's paper is not, and a wrong
paraphrase costs her socially in a small field.

Any autonomous publisher gets a **dead-man's switch**: it disables itself
without a periodic human heartbeat. The realistic failure is not a dramatic
hallucination; it is a job running unattended for months, degrading, unread.

**Client-side semantic search, sonification, live figure companions.** Genuinely
interesting; none are on the critical path.

## Risks

- **Gates that cry wolf get disabled.** The link gate must tolerate transient
  network failures and retry, or it will be the first thing switched off.
- **Figure-drift checking requires the paper repo**, which is private and has
  untracked `data/`. The gate must degrade to "unverified" honestly rather than
  silently passing.
- **Public provenance badges invite scrutiny.** That is the point, but it means
  the metadata has to be accurate — a badge claiming review that did not happen
  is worse than no badge.
