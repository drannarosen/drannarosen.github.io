# drannarosen.github.io — project guide

Professional website for **Dr. Anna Rosen**, computational astrophysicist and
Assistant Professor of Astronomy at San Diego State University. Greenfield
rebuild replacing an outdated WordPress site. `CLAUDE.md` is a symlink to this
file so Claude Code and other agent tools share one guide.

## What this site is

A flagship expression of Anna's research program — not a generic faculty
profile. It should read as authored by a computational astrophysicist with a
distinctive scientific program: massive stars, star clusters, stellar feedback,
and the differentiable scientific software (the Jaxstro ecosystem) built to
model, observe, and infer them.

Primary audiences (all matter): prospective grad students, peers & funding
panels, broader public & press, and Anna herself (a durable, maintainable home
for CV / links / software / a `/now` page).

## Locked design decisions (2026-07-18 brainstorm)

- **Scope v1:** sharp shippable core — homepage + ~4–5 real pages, content in
  markdown. Defer the heavy test/docs/ADR apparatus until the core ships.
  The failure mode to design against is over-engineering, not under-engineering.
- **Stack:** Astro **static** output + strict TypeScript + pnpm + custom CSS
  (cascade layers + design tokens). GitHub Pages via GitHub Actions.
- **No React yet (YAGNI).** The signature hero is a `<canvas>` driven by a
  plain `<script>` module (same pattern as Cosmic Playground's starfield). Add
  React only when a component genuinely needs client state (e.g. publication
  filtering). Do NOT add Tailwind, a UI component library, a CMS, or a backend.
- **Narrative:** research *questions* + real science lead. The Jaxstro
  ecosystem is a strong section but honestly **status-labeled** — most packages
  are partly real / in development, so never present them as shipped product.
- **Signature visual:** hero-only. A stylized **IMF-sampled star cluster**
  (stars sampled from an initial mass function, sized/colored by mass, drifting
  slowly). Reuse the *renderer architecture* from Cosmic Playground's
  `starfield.ts`, NOT its decorative twinkling-starfield look. Shared DNA,
  distinct identity. Motion is slow, scarce, and scientifically motivated.
- **Accessibility & motion:** respect `prefers-reduced-motion`, provide a
  visible pause control, keep text contrast at all times, site fully usable
  with JS disabled.

## Reuse source (do not copy wholesale)

`~/Teaching/cosmic-playground/` — Anna's teaching/outreach site, also Astro +
content collections. Reuse: renderer architecture (`packages/runtime/src/
starfield.ts` — offscreen compositing, DPR cap, reduced-motion, `cleanup()`),
color/motion philosophy, component patterns. This is Anna's *outreach* brand;
the pro site shares lineage but must have a distinct identity. Treat the old
WordPress site (anna-rosen.com) as a content/URL archive only — never imitate it.

## Deployment

Target: https://drannarosen.github.io/ (user site, root domain, **no base
path**). Migration to anna-rosen.com later changes only `site` in
`astro.config.mjs` — see `docs/domain-migration.md` when created. Do NOT touch
DNS or configure the real domain.

## Commands

```
pnpm dev        # dev server (prefer: astro dev --background)
pnpm build      # production build to dist/
pnpm preview    # preview built site
pnpm check      # astro type checking
```

Manage the background dev server with `astro dev stop`, `astro dev status`,
`astro dev logs`.

### Verifying layout in the browser preview

**Record the viewport in every layout measurement.** The preview pane silently
changes its own width — it has been observed dropping from 1440 to 528 px
between one call and the next, and `location.reload()` can reset it. A
responsive rule then correctly stops matching, and the result looks exactly like
a broken selector or a stale stylesheet.

This was misdiagnosed twice as "the dev server is serving stale CSS", and a
server restart appeared to fix it only because the restart was accompanied by
setting the viewport again. Investigated properly on 2026-07-20: with the pane
at 1440 px, an edit to a scoped `<style>` block was live in `getComputedStyle`
with **no reload and no restart**. Astro's CSS HMR works; do not restart the
server on layout weirdness, and do not rewrite working CSS.

Before concluding anything about a layout:

1. Include `innerWidth` in the same call that measures geometry — never infer it
   from an earlier call.
2. Set the width explicitly with `resize_window` immediately before measuring.
   The `desktop` preset yields the pane's native size (~1041 px), which is not a
   desktop width; pass 1440x900.
3. If a rule seems not to apply, check `matchMedia(...).matches` at the measured
   width before suspecting the toolchain.

Two related traps when reading the served CSS directly: Vite normalises values
(`magenta` becomes `#f0f`) and rewrites media queries (`(min-width: 60rem)`
becomes `(width >= 60rem)`), so grepping for the literal text you wrote reports
a false negative. It also strips CSS comments, so a `/* PROBE */` marker
vanishes.

## Conventions

- Strict TypeScript everywhere; avoid `any` and unchecked assertions.
- Content in Markdown via Astro content collections; typed schemas validate
  authored data at build time.
- Custom CSS with cascade layers + design tokens (colors, spacing, type scale,
  motion). No utility-class framework.
- Never fabricate publications, students, grants, collaborators, or software
  claims. Use clearly-labeled provisional records where needed to exercise the
  content system.
- **Never mention grant proposals** — in progress, submitted, or planned — in
  any published page, script comment, or committed doc. No funder names, no
  deadlines, no "after the X deadline". Timelines are stated without their
  cause: "methods paper in preparation", never "after the X deadline". This
  repository is public, so script comments and docs publish too.
- Write in the **first person**. This is Anna's own site: "I build…", not
  "Anna Rosen builds…". Names stay in metadata (`og:site_name`, `author`,
  `reviewedBy`) so provenance remains machine-readable.

## Analytics

Two tags ship, both in `src/layouts/BaseLayout.astro`, both **production-only**:

- **Google Analytics** (gtag.js, `G-50FCCTYBRH`) — in `<head>`.
- **Cloudflare Web Analytics** — end of `<body>`.

**Do not paste either tag into a page.** Google's setup text says to add the
snippet to every page, which is advice for hand-written HTML; here every page
renders through `BaseLayout`, so a new page inherits both automatically. Adding
one to a page would double-count that page's traffic and breaks Google's own
"no more than one Google tag per page" rule.

If a page ever bypasses `BaseLayout`, it gets no analytics — that is the correct
default, not a bug to patch per page. Add the layout instead.

Both are gated on `import.meta.env.PROD`, so `pnpm dev` never reports local page
views as real traffic. That also means neither tag can be verified from the dev
server; check the built output in `dist/` or the deployed site.

## Type

One knob: `--font-scale` in `src/styles/tokens.css`. `1` is normal; `1.05`
raises every size 5%. The eight `--step-*` values are hand-solved fluid
clamps — CSS cannot derive them from a base and a ratio, because that needs
dividing one length by another, which `calc()` forbids.

**Every `font-size` must use a `--step-*` token.** `pnpm check:type` fails the
build otherwise. This exists because 28 components had hardcoded 0.62–0.72rem
sizes, which is why "this text is too small" kept resurfacing however the
tokens were tuned — a scale that can be bypassed is a suggestion. `em` units
are allowed (context-relative by design); anything genuinely special needs a
trailing `type-scale-exempt: <reason>` comment.

## Vertical rhythm

`reset.css` zeroes every margin, so spacing is never automatic. Do not
reintroduce it per component — that is what left the paragraphs on
`/astrobytes` touching, because every author had to remember a rule that
nothing enforced.

Put `flow` (or `prose`, which includes it) on any container holding a stack of
block content:

```html
<div class="wrap flow">   <!-- p, ul, h2 … all space themselves -->
```

It uses the owl selector `> * + *`, so spacing lands only BETWEEN siblings —
never a leading or trailing margin the parent did not ask for. Tune a run with
`--flow-space` on the container or on one child rather than adding a class.

`prose` also caps the measure at `--width-prose` and indents lists. Use it for
reading text; use `flow` for any other stack.

Grid/flex containers with `gap` already handle their own rhythm and need
neither.

**Never put a measure cap on a `.wrap`/`.wrap-wide` element.** Those centre with
`margin-inline: auto`, so capping them re-centres the narrower box and its text
stops aligning with the headings above it. This has bitten twice (`/software`
intro, the `/astrobytes` note, which shipped indented). Put the cap on an inner
block instead:

```html
<div class="wrap">          <!-- centres the column -->
  <div class="prose flow">  <!-- caps the measure, stays left-aligned -->
```

## Figures

**`src/data/figures.json` is the only place a figure is described.** Path, alt
text, dimensions, title, credit and captions live there once; pages reference a
figure by **id** (the filename without its extension) through
`src/lib/figures.ts`. Never retype a figure's alt text or dimensions into a
page — `getFigure(id)`, `figureImage(id)` and the `<Figure id="…" />` component
resolve them.

Before this, each page that showed a figure re-declared its description. Five
of ten figures appear in more than one place, so that was the normal case, and
it is what let a replacement gravax figure leave `/research` asserting the
previous run's number. A single record makes that impossible rather than
merely detectable.

Only genuinely per-page choices stay at the call site: which caption variant
(`full` for the figure's home page, `short` where it appears in passing) and
layout (`captionPlacement`, `contain`, `side`). Astrobytes captions remain MDX
children, because they carry markup and inline math and cannot live in JSON
without ceasing to be MDX.

**Every figure is height-bounded by one shared rule.** `--figure-max-block`
(tokens.css) is the cap; `.figure-box` (figures.css) enforces it by capping the
image's WIDTH at `--figure-max-block x aspect-ratio`, with the ratio passed in
per figure by `figureBox()`.

Never cap a figure with `max-block-size` and `inline-size: auto`. That is the
obvious way and it silently breaks space reservation: an unloaded lazy image
has no intrinsic width for the aspect ratio to multiply, and figures were
measured collapsing to 9x9 with their `width` and `height` attributes present.
Bounding width keeps `inline-size: 100%`, so the box comes from the container
and the height follows.

`--figure-max-block` is a knob a context may raise — a wide figure in a post is
the argument, not an aside, and at the default a four-panel figure came out
577px wide with unreadable axes. Set the token on the container rather than
writing a second sizing rule.

To sit a figure inline with prose, add `figure-inline` (or `<Figure inline="end" />`).
It floats and text runs alongside, returning to the flow below 46rem.

`pnpm check:markup` (postbuild) fails if any image under a figure directory
renders without `figure-box` and a `--figure-ar`. A figure that opts out is not
broken, which is exactly why it needs a gate — four different sizing opinions
accumulated that way. Photographs are excluded by directory: single-use, no
provenance claim, bounded by their own columns.

`pnpm check:figures` enforces five things: the file matches its recorded
sha256, its recorded dimensions match the file, nothing is served from a figure
directory without provenance, no image under `public/images/` is shipped
without something referencing it, and **the set of files referencing a figure
matches its `usedIn` record**.

`usedIn` records where each figure is referenced, matching on **id or
filename** — pages use ids, while the OG card generator still works in paths.
When that set changes the build fails until the record is updated, which keeps
the map of where a figure appears honest even now that its description lives in
one place.

Figure filenames are stable identifiers (`gravax-demo-01.webp`), not
descriptions. Content can change under the same name: GitHub Pages serves
images with `max-age=600`, so a replacement propagates within ten minutes and
no cache-busting suffix is needed. The orphan check exists because a rename is
a delete plus an add, and the delete half is invisible — the site keeps
working while the old file keeps shipping.

Captions are authored as journal captions (`**(a)**`, `\( ... \)`) and rendered
by `src/lib/figureCaption.ts`. `pnpm check:markup` (postbuild) scans the built
pages for those markers surviving as literal text, which is what happens when a
template prints `{f.caption}` instead of piping it through `renderCaption`.
It reads `dist/`, not the source, because that mistake produces valid HTML,
valid YAML and a passing type check — the built page is the only place it
shows. KaTeX stores the original LaTeX in `<annotation>` for screen readers, so
the scan strips those first; otherwise every correctly-rendered equation would
report as a failure.

## Astrobytes

Every post's `paper.ads` is **required** by the schema, and the paper title —
on the post and on the hub card — links to it. A reader is then always one
click from the record rather than from a summary of it, and ADS is the record:
it carries the abstract, the citation graph and the published version, which an
arXiv link alone does not.

Required rather than optional because a link that is usually there is a link a
reader stops looking for. A post without one fails the build with
`paper.ads: Required`, instead of quietly shipping an unlinked title.

## Naming

Settled 2026-07-19; do not "correct" these back.

| form | use |
| --- | --- |
| **Jaxstro** | the ecosystem, in prose. Title case, never `JAXSTRO` or `JAXstro` |
| `jaxstro` | the foundation package, in code/monospace — as with `progenax`, `gravax`, `startrax`, `fluxax`, `informax` |
| **JAX** | the library only, e.g. "JAX-native", "collisional dynamics in JAX" |

Why: the `-ax` suffix already signals the JAX ecosystem, so the name does not
need to shout it; all-caps reads as an acronym and invites "what does it stand
for?"; and internal caps would make `JAXstro` the only package in the family
with a capital, right above five lowercase siblings on `/software`.

## Astro documentation

Full docs: https://docs.astro.build — consult before related work:
- [Routing / pages](https://docs.astro.build/en/guides/routing/)
- [Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Framework components (React)](https://docs.astro.build/en/guides/framework-components/)
- [Content collections](https://docs.astro.build/en/guides/content-collections/)
- [Styling](https://docs.astro.build/en/guides/styling/)
