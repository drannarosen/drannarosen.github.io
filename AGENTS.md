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
