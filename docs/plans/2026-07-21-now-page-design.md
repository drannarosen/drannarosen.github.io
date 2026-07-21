# /now, rebuilt — design

Agreed 2026-07-21. Supersedes the derived-only version of `src/pages/now.astro`.

## The problem

The page shipped three faults, in descending order of seriousness.

**It asserted something false.** The Teaching section rendered `courses.slice(0, 2)`
— the first two entries in array order, not the current ones. In July 2026 that
claimed ASTR 596 (Fall 2025) and COMP 536 (Spring 2025, 2026). A `/now` page has
one job.

**Nothing on it was authored.** Every item derived from `packages`,
`publications`, and `teaching`. That guaranteed consistency with the rest of the
site and, in the same stroke, guaranteed the page said nothing the rest of the
site did not. Derived data can report what exists; it cannot say what matters.
A `/now` page is entirely about what matters.

**It capped the measure on a `.wrap` element**, which re-centres the narrower
box so the text stops aligning with the headings above it — the third instance
of a mistake the project guide already warns about twice.

## Shape

Five sections. Cheeky headings, warm first-person prose, derived data demoted to
supporting detail.

| heading | content |
| --- | --- |
| On my desk | The progenax methods paper. Timeline as "later this summer" — never a hard date. |
| Where the interesting problems are | gravax and startrax, with the existing readiness bars, unchanged. |
| Simmering | fluxax and informax. One line, small, dim. Real, not the focus. |
| Teaching | Derived from term and year. Summer is not a term and gets its own sentence. |
| Side projects | Sophie and Cosmic Playground. No readiness bars, no roadmap. |

"Under review" is deliberately gone. One submitted paper does not need a
heading, and a section that stands empty half the year reads as neglect; it
belongs in a sentence under "On my desk".

Prose is Anna's, or drafted from facts she supplies. Nothing about the progenax
paper or Sophie is written from inference.

## Figure strip

A rotating figure — a new plot when there is one worth showing. This replaces an
earlier idea of a canvas-drawn IMF star, which would have been decorative and
would have competed with the homepage hero. A plot is real science, needs no
second animated canvas, and reuses the provenance system already built.

**Data.** `nowFigures` in `src/data/`: slug, path, caption, date. Images in
`public/images/now/`, recorded in `src/data/figures.json` like every other
figure, so sha256, dimensions, `usedIn`, and orphan detection apply unchanged.
Each figure carries its own date, so the strip self-dates even when the page
stamp is stale.

**Cap: five.** The build FAILS at six, naming the oldest, rather than silently
dropping it. A silent drop would ship an invisible figure and leave the author
wondering why the new plot never appeared. Retiring an entry then strands its
file, which the orphan check reports — two gates covering the two halves of one
action.

**Rendering.** A CSS scroll-snap strip: one figure per slide, caption beneath,
date stamped small. Prev/next as in-page anchors, so keyboard and JS-off both
work; native swipe on touch; smooth scrolling behind `prefers-reduced-motion`.
No React and no JavaScript. React would buy smoother transitions and nothing
else, and the no-React decision holds. Captions render through `renderCaption`,
so panel labels and inline LaTeX behave as they do on package pages.

**Authoring matters more than architecture here.** The figure gates are
deliberately strict, which is right for a plot making a claim on `/research` and
fatal for a feature whose premise is "when I feel like it". Ten minutes of
hand-edited JSON per rotation and the feature dies after two. So:
`pnpm figure:add <file> <slug>` copies the image, computes hash and dimensions,
appends the manifest entry, and stubs the caption. The gates stay strict; the
typing goes away.

## Sky over San Diego

One computed sentence under the header: solar altitude and time to astronomical
twilight at 32.72° N, 117.16° W, from the visitor's clock.

`sin(alt) = sinφ sinδ + cosφ cosδ cos H`, twilight at −18°. Validate against the
NOAA solar calculator at several dates across the year before shipping — a wrong
sun angle on an astronomer's page is worse than none.

Fixed to San Diego, not the visitor. It is a statement about where the work
happens, it stays true for every reader, and it needs no permission prompt or IP
lookup. A ~40-line client module with a static fallback in the HTML, so JS-off
readers get a plain sentence rather than an empty slot. No API, no third-party
request.

This satisfies the site's motion rule rather than bending it: slow, scarce, and
scientifically motivated.

## Date stamp

Derive from the commit that last touched the page's content, replacing the
hand-typed `new Date(...)`. The page's one honest claim should not be the one
most likely to rot.

**CI trap, recorded before it bites:** `actions/checkout` defaults to
`fetch-depth: 1`, and `git log -1 -- <path>` returns nothing when that file was
absent from the single fetched commit. The date would then vanish in production
while working perfectly on every developer machine. The workflow needs
`fetch-depth: 0`, and a missing date must fail the build rather than render
blank.

Keep a staleness warning at roughly 90 days. Git records when the page last
changed; it cannot tell that the page has started lying.

## Not doing

- **Commit sparkline.** Makes productivity legible in a way that punishes weeks
  spent thinking rather than typing, and turns a personal page into a metric.
- **Per-package progress commentary.** The bars are enough. Explaining them is
  over-telling.
- **Visitor-local sky.** A toy, where the fixed version is a self-portrait.
- **An archive of retired figures.** The cap is the point. Git keeps every
  version if a feed is ever wanted, so the archive can be built later from
  history — building it first is how a fun idea becomes a chore.
