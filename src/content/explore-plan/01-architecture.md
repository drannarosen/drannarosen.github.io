---
title: "Architecture — one contract, two axes, one cluster"
kind: overview
order: 1
status: spec
tagline: "The load-bearing design: machinery now, physics swapped in later, nothing bypassed."
research: ["startrax", "gravax", "fluxax", "informax", "progenax"]
---

The design that lets the series stay honest, DRY, and swappable as the physics matures.
Every chapter and engine is built against the contracts below; none reaches past them.
This is the one place the model strategy lives — engine specs reference it rather than
restating it (so the two can never drift).

## 1. The star contract

One function every engine reads from:

```
star(M, Z, t) → { L, R, Teff, phase, Mdot, remnant, … }
```

Nothing calls the ZAMS formulas directly. The HR plot, the colour mapping, the
size-by-radius, the remnant hand-off all consume the *contract*, not its backend — so
when the backend improves, every engine upgrades at once. The contract already carries
`t` and `phase` even while the current backend can barely move a star off the ZAMS; that
is what makes the later swap reach every engine instead of one.

**The rule that makes it load-bearing:** if an engine reaches past `star()` and calls
`zamsLuminosity(M)` itself, it silently hard-codes "stars never age" into that engine and
the startrax swap won't reach it. The contract is only a source of truth if nothing
bypasses it — the same discipline as the `--step-*` type tokens.

## 2. The model ladder (now → later → last)

`star()`'s backend climbs one ladder; the UI never notices a rung change.

| Rung | Backend | Honesty line |
| --- | --- | --- |
| **now** | Tout (1996) ZAMS L/R/Teff + Hurley (2000) `t_MS` as a lifetime clock | "ZAMS values; a star only lives or dies, it does not yet move" |
| **later** | precomputed **startrax** tracks — L(t), R(t), Teff(t), phase — interpolated | "startrax evolutionary tracks" |
| **last** | a **differentiable surrogate** trained on those tracks | "differentiable startrax surrogate" |

Most engines never leave rung 0 or need a surrogate at all — they are cheap-analytic-live
(IMF, feedback ledger, N-body, reddening) or pure lookup tables (yields, remnant maps). A
surrogate earns its complexity only where the true model is too heavy to run live **and**
the reader drags a *continuous* parameter. By that test one differentiable stellar model
is worth building — and it pays for **two** engines at once: Stellar Tracks (smooth
forward `star()`) and Inference Reckoning (gradients through the same forward model). Build
it once; it is spine infrastructure, not a finale bolt-on.

**N-body is the deliberate exception** — for a few hundred stars a symplectic integrator
runs live in JS, energy-conserving, honestly. It is the one engine where the reader watches
*real* physics integrate; a surrogate there would throw that away. Dynamics owns positions;
`star()` owns everything intrinsic; the two compose.

## 3. One canonical cluster — minimal latent state

The cluster stores only the latent truth per star:

```
{ id, mass, Z, x, y, z, vx, vy, vz }   ← the only stored state
```

`L`, `R`, `Teff`, `phase`, `Mdot`, colour, spectral type, remnant — **none are stored**.
All are derived on demand through `star(M, Z, t)`. This is why "these are the stars I made
earlier" is literally true rather than a UI trick: every engine is a pure view over the
same seed, so the massive star clicked in the Census is the same `id` that loses mass in the
winds lab and leaves a remnant later — re-derived at a later `t`.

- **`Z` is a cluster property**, not per-star (a coeval cluster is chemically uniform, and
  it keeps the track tables 1-D in mass). Chemical spreads are a later teaching option.
- The whole cluster is `(seed, IMF params, t)` — reproducible and URL-shareable for free,
  which is the reproducibility your program is about, made tactile.
- **Two guardrails** so theory work never walls off `observe()` later: keep 3-D positions
  authoritative (the on-screen 2-D is a derived view — never flatten `z`); keep the contract
  in physical units (colour is derived, never stored).

## 4. Two axes per chapter

Every chapter is the same object seen along two orthogonal axes.

- **Depth** — *Story / Inspect / Derive*. Story reads nothing; Inspect reads the contract
  live (sliders mutate `M`, `t`); Derive exposes the backend's equations, assumptions,
  references and package provenance. "Choose your depth" is three renderings of one physics
  object, so a backend swap updates every Derive panel in one place.
- **Face** — *Theory / Observation*. The latent truth vs what a telescope delivers. This is
  the deepest use of the heartbeat toggle, and the pedagogical thesis: **astronomy needs
  both**, and most students never see the seam.

## 5. observe() — a seam we name now, a stub we do not build

Theory is the whole build for now; `observe()` is deferred. But its *foundation* falls out
of theory work for free, so we pre-wire it without writing it:

- **Free foundation** (theory needs all of it anyway): minimal physical latent state; the
  `star()` contract; the **Teff→colour** function (Pecaut–Mamajek — already used to colour
  the dots, and *literally rung 0* of `observe()`); the **face-agnostic compare primitive**
  (built for isolated↔N-body and winds on/off; theory↔observation is later just one more
  configuration).
- **The one deliberate move:** name the boundary — colour/photometric quantities are "the
  observation face, rung 0," living behind one module edge so `observe()` later *extends one
  place* instead of being retrofitted across chapters.
- **Not built now:** no instrument ladder (distance → extinction → noise → blending →
  incompleteness), no `infer()`, no speculative `observe()` signature with unused
  parameters. A seam costs nothing and prevents lock-in; a stub is maintenance for an
  undesigned feature. We build the seam.

The finale then invents nothing: truth = `Cluster(seed)`, observed =
`observe(stars, t, realistic)`, inferred = `infer(observed)` — three views of one object,
the same three functions every chapter already used.

## 6. Reusable primitives (built once)

- **Compare / heartbeat toggle** — "two states of one cluster," face-agnostic.
- **Confidently Wrong** — a callout taking `{ truth, naiveModel }` and rendering the gap;
  dropped into any chapter (small-N IMF, unresolved binaries, ignored extinction, the
  finale). One definition, many views — the pedagogical twin of the star contract.

## 7. Where the site ends and the codes begin

The site **consumes** the Jaxstro codes' output; it never re-derives their physics. Tracks,
remnant maps and (later) surrogate weights are produced offline in startrax/gravax/fluxax
and shipped as data the browser reads. That keeps the site honest ("this *is* startrax") and
keeps it decoupled from the research repos. The differentiable surrogate is trained in JAX
and exported, never reimplemented in TypeScript.

## 8. Portability & module layering

Built **in this repo first** — extraction is insurance, not a committed roadmap — but
designed so it *could* lift out if it ever gets attention. Four layers, each depending only
**downward**; the boundary is what makes it versatile.

```
Layer 3  bindings/UI   Astro islands, pages, sliders          site-specific, swappable
Layer 2  viz           canvas/WebGL renderers (HR, field)     any-canvas, no framework import
Layer 1  state         store: identity/view/log + adapters    framework-light
Layer 0  science core  stellar · imf · dynamics · cluster     ZERO deps, ZERO DOM, pure
```

**The load-bearing rule: Layer 0 imports nothing but Layer 0** — no Astro, no DOM, no
`window`, no site paths; pure, deterministic functions. That one constraint is what lets the
same code run in the browser, in Node (tests + precompute), and in a course notebook,
unchanged. Portability and testability are the same property: `check-stellar` already
exercises the pure core in Node against the startrax fixture.

**Core layout — split by physical domain:**

```
core/ constants/  random/  stellar/  imf/  dynamics/  cluster/  observe/(later)
```

- `dynamics/`, not `gravity/` — the subject (integrators, energy, relaxation) with the force
  a file inside it; the integrators are the reusable part.
- `random/` is its own module — one seeded stream (mulberry32, explicitly passed, never
  global `Math.random`) shared by IMF, spatial profiles and N-body ICs, so identity→population
  is a pure, reproducible function. This is the keystone of the seed-based design.

**Naming honesty:** the core is **not** named `startrax` / `gravax` / `progenax`. The site
consumes those codes' *data*; this TS core is a small live reimplementation of the *physics*,
not those packages. Neutral domain names (`stellar`, `dynamics`, `cluster`) keep the claim
true — calling `dynamics` "gravax" would imply the browser runs gravax, which site-claims
forbids.

**Enforce now, extract later (packaging decision):** core lives in `src/lib/core/` with an
**import-boundary gate** (in the spirit of `check-sun`/`check-stellar`) that fails the build
if anything in `core/` imports Astro/DOM/site, or if a layer imports upward. No monorepo, no
npm publish now — those are premature while it is one site. Because every consumer repo
(Cosmic Playground, the Sophie/ASTR 201 site, future courses) **and this site** are all
Astro, the natural eventual extraction is a single **Astro integration** wrapping Layers 2–3
over a plain-TS Layer 0 — following the Cosmic Playground `starfield.ts` renderer lineage
(offscreen compositing, DPR cap, reduced-motion, `cleanup()`). The layering delivers that
versatility whether or not the extraction ever happens. The mechanics of that extraction —
the three couplings to avoid now (prefixed tokens, factory store, no SSR `window`), the package
anatomy, and the checklist proving the move is a folder move — are in the
**[Extraction blueprint](/explore-plan/04-integration-blueprint)**.

**Arc I sequencing (recommended, pending "go"):** introduce `src/lib/core/` *with* the gate
as the first code; move the already-pure, already-validated `stellar.ts` and `imf.ts` into
`core/stellar/` and `core/imf/` to establish the boundary with real content rather than a
split brain.
