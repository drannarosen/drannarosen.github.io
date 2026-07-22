# Hover-a-star: an interactive cluster inspector — design

**Status: design, not built (2026-07-22).**

A free-explore coda at the end of the `/explore/cluster` "Birth of a cluster"
story: hover (or tap) any star in a cluster and see its real, physics-grounded
properties, with its point lighting up on a live HR diagram. It turns the
signature cluster visual from a picture into an instrument.

This is the first of four planned "playable science" additions; the other three
(a sample-your-own-cluster sandbox, the *Confidently Wrong* precise-yet-wrong
demo, and a colophon/uses page) reuse the science core this one establishes.

## Why this shape

- **Dedicated page, not the homepage hero.** The hero has headline text and CTAs
  over the canvas; per-star hovering there fights the text. The `/explore/cluster`
  page is uncluttered and already hosts the shared cluster engine.
- **A coda, not a new page.** The six-scene scroll story ends on "The massive
  stars"; a "now explore it yourself" section right after earns the payoff and
  reuses the setup.
- **A fresh 2D inspector, not the WebGL engine.** The coda is calm (still or
  gently rotating), and precise hit-testing — "which star is under the cursor?" —
  is trivial in a 2D canvas where positions are known in JS, and genuinely hard
  on GPU-drawn points. The HR diagram pairs naturally as a second 2D panel.

## The science core (the reusable half)

A new `src/lib/stellar.ts` holds the ZAMS physics as small, pure, individually
tested functions, each with a provenance comment citing its authority. **No
magic numbers.** Everything is **zero-age main sequence at solar metallicity**
(Z = Z☉) — correct for a just-formed cluster, and stated plainly to the reader.

| Function | Physics | Source (ported from startrax, same equation digest) |
| --- | --- | --- |
| `zamsLuminosity(m,Z)`, `zamsRadius(m,Z)` | Tout ZAMS L, R | Tout et al. (1996), MNRAS 281, 257 — `startrax .../foundations/zams.py` (digest `tout1996-zams`, checked 75/75 vs PDF) |
| `effectiveTemperature(L,R)` | Stefan-Boltzmann, Teff☉ = 5772 K | derived, no new fit |
| `spectralType(Teff)` | empirical dwarf sequence | Pecaut & Mamajek (2013), ApJS 208, 9 (small embedded table; **only piece not in startrax**) |
| `msLifetime(m,Z)` | Hurley t_MS | Hurley, Pols & Tout (2000), MNRAS 315, 543 — `startrax .../foundations/boundaries.py` |
| `remnantFate(m,Z)` | Fryer rapid/delayed remnant + PISN | Fryer et al. (2012), ApJ 749, 91 — `startrax/src/startrax/remnant_prescriptions.py`, `pair_instability.py` |

Porting rule: transcribe coefficients **from startrax's verified implementation**
(and its equation digests), not from memory or any GPL reference code, so the web
copy inherits startrax's provenance. Tout is valid `0.1 ≤ M/M☉ ≤ 100`; clip Z to
`[1e-4, 0.03]` (Tout forbids metallicity extrapolation).

`imf.ts` is refactored to call `stellar.ts` instead of its toy `M^0.53` / `M^3.5`
scalings, so the hero, the story, and the coda all share one physics-grounded
core. Cost is a few polynomial evaluations per star at sample time (not per
frame), so the hero's frame loop is unaffected; its realism improves slightly.

## Validation (ships gated, per the correctness hierarchy)

A real test file for `stellar.ts`:

1. **Solar round-trip:** M=1, Z=Z☉ → L≈1 L☉, R≈1 R☉, Teff≈5772 K, t_MS≈10 Gyr.
2. **Massive anchor:** ≈20 M☉ → Teff≈35,000 K, L≈10⁴·⁵ L☉, t_MS≈few Myr, fate = BH/CCSN — within ~10% of the literature.
3. **Spectral-type boundaries** land at the right Teff (O/B/A/F/G/K/M).
4. **Cross-check against startrax** at a few masses (the port must reproduce the source it came from).

## The two panels & interaction

- **2D cluster inspector** (left) and **live HR diagram** (right); stacked on
  mobile. Both draw from one `sampleCluster()` array, so they are guaranteed to
  be the same stars.
- **Desktop hover:** star dot enlarges, HR point lights up, star-card fills
  (mass, spectral type, Teff, L, R, t_MS, fate). Idle rotation pauses on hover.
- **Touch:** tap to pin a card; tap elsewhere to dismiss.
- **Keyboard / no-pointer:** a "pick a notable star" control cycles a curated few
  (biggest O star, a Sun-twin, a red dwarf) — operable without a mouse and teaches
  the extremes on purpose.
- **Reduced-motion:** no idle rotation; still fully interactive.
- **No-JS:** a static labelled snapshot (pre-rendered cluster + HR pair) replaces
  the canvas — the page never breaks.

**Always-visible honesty line:** "Zero-age main sequence, solar metallicity.
Properties from Tout+1996, Hurley+2000, Fryer+2012 — illustrative, not an
evolution run."

## Explicitly out of scope (YAGNI)

Time evolution, metallicity control, binary stars, a mass/α sandbox (that is the
*next* build, which reuses this core), and any homepage-hero interactivity.

## Build order

1. Port + validate `stellar.ts` (the science core) — gated by its test file.
2. Refactor `imf.ts` to use it; confirm the hero still renders correctly.
3. Build the coda: 2D inspector + HR diagram + star-card + interaction.
4. Accessibility passes (touch, keyboard, reduced-motion, no-JS) and browser
   verification at 1440px.
