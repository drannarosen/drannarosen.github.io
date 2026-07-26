---
name: explore-authoring
description: Use when building or editing anything in the "Lives & Deaths of Star Clusters" explorable series — a page under /explore, a Novascope engine or component, a chapter or engine spec under src/content/explore-plan, or physics in src/novascope/core that an explorable reads. Enforces the four rules that keep the series honest and swappable: go through the star() contract, store only latent state, state the model rung on the page, and never let the site claim to run the research codes. Don't use for the star-render lab's measurements (lab-measure), general page copy (site-claims), derived data and build gates (site-integrity), or shipping (site-verify).
---

# Authoring the explorables

The series is specified in `src/content/explore-plan/` — read
`01-architecture.md` before writing code, and the chapter or engine spec before
building one. Those are the source of truth; this skill is the part that is easy
to violate without noticing.

## 1. Everything intrinsic goes through `star(M, Z, t)`

`src/novascope/core/stellar/index.ts` exports the contract. Engines read it —
never `zamsLuminosity`, `zamsRadius`, `zamsTeff` directly.

**Why it is load-bearing:** the backend climbs a ladder (Tout ZAMS now →
precomputed startrax tracks → differentiable surrogate) and the UI is supposed
not to notice. Code that reaches past the contract hard-codes *"stars never age"*
into itself, and the startrax swap silently fails to reach it. The bug is
invisible: the page keeps working and quietly stops improving.

**This is NOT gated.** `check-novascope-boundary` enforces layer direction, not
contract bypass. Known direct callers, intent unconfirmed — check before adding a
fourth:

- `core/imf/index.ts` — `zamsTeff` / `zamsLuminosity` for a mass→colour ramp
- `core/photometry/completeness.ts` — `zamsTeff` / `zamsRadius` for a limiting magnitude
- `core/feedback/sources.ts` — referenced in a comment

## 2. Store latent state only

The cluster stores `{ id, mass, Z, x, y, z, vx, vy, vz }` and nothing else. `L`,
`R`, `Teff`, phase, colour, spectral type, remnant are **derived on demand**.

That is what makes "these are the stars I made earlier" literally true rather
than a UI trick, and it is what makes `(seed, IMF params, t)` a complete,
URL-shareable description of a cluster.

Two guardrails the spec calls out because they wall off `observe()` if broken:

- **Keep 3-D positions authoritative.** The on-screen 2-D is a derived view;
  never flatten `z` into storage.
- **Keep the contract in physical units.** Colour is derived, never stored.

`Z` is a cluster property, not per-star — a coeval cluster is chemically uniform,
and it keeps track tables 1-D in mass.

## 3. Say which rung the physics is on, on the page

Every explorable makes a claim each time it renders. The claim must be true *at
the rung the backend is actually on*:

| Rung | Backend | The honesty line |
| --- | --- | --- |
| now | Tout (1996) ZAMS + Hurley (2000) `t_MS` | "ZAMS values; a star only lives or dies, it does not yet move" |
| later | precomputed startrax tracks | "startrax evolutionary tracks" |
| last | differentiable surrogate on those tracks | "differentiable startrax surrogate" |

A page that shows a star "evolving" while the backend only knows ZAMS values is a
false claim in exactly the sense [[site-claims]] forbids — it is a picture
asserting physics the code does not contain. When the rung and the visual
disagree, change the visual or state the limit; do not let the animation imply
the model.

## 4. Never imply the browser runs the research codes

The site **consumes** the Jaxstro codes' output; it never re-derives their
physics. Tracks, remnant maps and surrogate weights are produced offline and
shipped as data.

So the core is named `stellar`, `dynamics`, `cluster` — deliberately **not**
`startrax`, `gravax`, `progenax`. Calling `dynamics` "gravax" would assert that
the browser runs gravax, which is untrue.

"The same sampler my `progenax` code uses" (as `/explore/census` says) is fine —
it names a shared *method*. "Computed by progenax" would not be.

## 5. Layering, and why it is not optional

```
Layer 3  components   Astro islands, pages, sliders
Layer 2  viz          canvas/WebGL renderers
Layer 1  state        store + adapters
Layer 0  core         pure physics — imports ONLY Layer 0
```

Gated by `check-novascope-boundary` (ADR 0012): no Astro, no DOM, no upward
imports, no relative import escaping the package. Inside `src/novascope/` use
relative `.ts` imports; the `@novascope/*` alias is for consumers at the seam —
see [[novascope-shared-package]].

## Working on a spec rather than code

Specs live in `src/content/explore-plan/` (dev-only, never built in production)
with `kind: overview | chapter | engine | deepdive | tooling` and
`status: idea | draft | spec | building | shipped`. Move `status` when the thing
actually moves — a spec marked `shipped` that isn't is the same class of untrue
claim as rung drift.

Engine specs reference `01-architecture.md` for model strategy rather than
restating it, so the two cannot drift. Keep it that way.

## Before calling an explorable done

The heartbeat of the series is **toggle one physical process, hold the rest
fixed**. If a page has no such toggle it is an illustration, not an explorable —
which may be fine for a Story-depth chapter, and is not fine for an engine.

Verify in the browser at 1440px and confirm the deploy went green — see
[[site-verify]].
