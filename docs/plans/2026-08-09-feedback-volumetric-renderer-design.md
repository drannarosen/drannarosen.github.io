# The volumetric renderer for /explore/feedback-budget

Agreed with Anna 2026-08-09. Nothing is built. The bar set for this work was "good enough that
science museums would want to use it", and the target chosen was the full presentation tier —
port, illumination, accumulation, HDR, depth interleaving — not a port alone.

## Why

`/explore/feedback-budget` is finished as physics and held back from the `/explore` hub. Its
visual is the last thing standing between it and the standard set by census and dynamics.

The starting request was to move it onto "the three.js + WebGPU animations we made for the
dynamics and census pages". Half of that premise was wrong, and the correction is the reason this
document exists rather than a patch.

## What each page actually renders through

Read 2026-08-09, not recalled:

| page | module | stack |
| --- | --- | --- |
| `/explore/census` | `viz/clusterField.ts` via `mountCanvas` | canvas-2D — `getContext("2d")` |
| `/explore/dynamics` | `viz/clusterPoints.ts` | three.js + WebGPU, WebGL2 fallback |
| `/explore/feedback-budget` | `viz/webgl/engine.ts` | hand-written WebGL2 raymarcher |

**Census is not on three.js.** Only dynamics is. Feedback is on a third stack, and that stack is
the only renderer in the repository that can draw 3-D turbulent gas — `viz/webgl/index.ts` says so
outright.

So this is not a swap. `clusterPoints` draws points and nothing else: its API is `setModel`,
`setPositions`, `setAlpha`, `setTrail`. Pointing feedback at it would delete the cloud, which is
the subject of the page.

Sizes, for scale: `shaders.ts` 151 lines, `engine.ts` 408, `scene.ts` 64, `interaction.ts` 103,
`clusterPoints.ts` 669.

## Decisions

**1. One scene host, two layers.** The renderer, canvas, DPR cap, resize observer,
`prefers-reduced-motion`, pause-when-hidden and `cleanup()` are extracted into a shared host.
`clusterPoints` becomes the star layer, unchanged in behaviour; a new TSL raymarch becomes the gas
layer. Both live in one three.js scene with one camera.

The star pass is **reused, not rewritten**. Its look is already calibrated against
`renderClusterField` term for term, it already ships on dynamics, and rewriting it would put that
calibration back in play for no gain.

**2. The volume is drawn as a box mesh, not a fullscreen triangle.** Real geometry gives real
depth, which is what makes correct star/gas interleaving possible at all. The current fullscreen
raymarch cannot participate in a depth test.

**3. The shared projection is ORTHOGRAPHIC, and the volume moves to meet the stars.**

*Revised 2026-08-09 while reading the seam for step 2; the original decision here was to force a
three.js `PerspectiveCamera` to reproduce `VOLUME_CAMERA` exactly. That is not possible, and the
conflict was missed when this was written.*

The two renderers were built on opposite camera choices, each for a stated reason:

- `clusterPoints` uses an `OrthographicCamera` **by design** — "a perspective camera would make a
  star's apparent size depend on its depth, which would fight the one thing this renderer is for:
  apparent size carries luminosity and nothing else."
- the volume raymarch is **perspective** — `ro = (0,0,eyeZ)`, `rd = normalize(vec3(uv*FOV*uZoom,
  -FOCAL))`, rays diverging from an eye point.

One scene with real depth interleaving needs one projection, so one of them has to move. Making the
stars perspective would break the diagram law and is rejected outright. So the **volume becomes
orthographic**: parallel rays into the box.

That is a genuine improvement rather than a concession. An orthographic projection of a density
cube is a legitimate scientific rendering, and it means a length on screen denotes the same
physical length everywhere in the frame — which a figure about where feedback acts should want.
It does visibly change `/explore/feedback-budget`: the cloud loses its perspective depth cue.
Agreed with Anna before any code moved.

`camera.ts` keeps its role — the three numbers in one place, `camera.test.ts` asserting the ray
march and the closed form invert each other — but `fovScale`/`focal` now parameterise a parallel
projection, and the test gains the three.js camera as a third party that must agree.

**4. `viz/webgl` does not retire on day one.** It stays as the parity reference until the new path
matches it, then goes. The milestone of stage 1 is not "the port compiles", it is "the port
matches the reference image".

**5. Illumination is rung 1 first, rung 2 second, and the two stay separately labelled.** Rung 1 is
grey absorption with single scattering: opacity *shape* from Gordon et al. (2023) — already in
`core/extinction`, coefficients verified digit-by-digit against the PDF with two errata applied —
evaluated at three effective wavelengths, so dense filaments redden because the extinction curve
says they do rather than because a gradient was chosen.

Rung 2 adds a multiple-scattering approximation, which is what makes a dusty cloud read as
volumetric rather than as a shell with a dark interior. It is a fudge, it is the rung most likely
to draw a reviewer's eye, and it ships **labelled as a presentation term, visibly separate from the
rung-1 claim**.

Rung 3 — frequency-dependent transfer — is named here only to rule it out, and to record that the
page must never imply it.

**6. The κ normalization does not get typed from memory.** G23 gives A(λ)/A_V, a shape. Converting
to cm² g⁻¹ needs an N_H/A_V anchor and a dust-to-gas ratio. Both are real and citable; neither goes
into the repository until it has been read in a source and recorded with a locator, per the
`BJ_VRATIO` precedent. `check-constants` gates it.

**7. The light volume is 64³ against top-N sources, and N is chosen by captured fraction.**
Illumination is an integral, so the field is smooth and does not need the density's resolution.
Measured bolometric concentration:

```
name                nstars   N@90%   N@99%  N@99.9%  top1 %L
diffuse               1030       3       9       21    55.64
orion                10301       8      39      124    21.09
compact              51507      55     259      752     8.69
orion-solenoidal     10301       8      39      124    21.09
orion-compressive    10301       8      39      124    21.09
orion-shallow        10301       8      39      124    21.09
```

Eight stars carry 90% of Orion's light out of 10,301; a single star carries 55.6% of `diffuse`'s.
So ~500M samples for N=32 at 64 shadow steps — a one-time dispatch of tens of milliseconds, not a
per-frame cost. The captured fraction is **displayed and gated**, the same move as `nOutOfRange` on
the wind channel: a reader can see that the lighting used 39 of 10,301 stars and that those 39 are
99% of the light.

This table is also a scientific result the page currently has no way to show. `diffuse` is lit by
essentially one star and `compact` needs 55 to reach 90%, so a single lamp in fog versus a
distributed glow is a *visible physical difference* between a low-mass and a massive cloud. It is
the strongest argument that rung 1 is physics rather than polish.

**8. The light volume rebuilds on a ladder, not per frame.** It is view-independent, so orbiting is
free. It rebuilds only when the expulsion state moves materially, interpolated between rungs in S.

A tempting shortcut was rejected. Under homologous expansion the shader maps rendered position
**x** to material at **x/S** with ρ → ρ/S³, so substituting into τ = ∫κρ dl with u = y/S gives

    τ_new(x, x_s) = (f/S²) · τ_0(x/S, x_s/S)

which suggests one precomputed volume rescaled analytically. But the shader also records that
*"Stars don't move → bare cluster emerges"*: the gas expands past the sources, so the (f/S²) factor
is exact for the gas's own opacity while the source geometry underneath it is not preserved. The
error grows with S — worst in the late frames, which is exactly where the reader is looking.

**9. Stars composite into the raymarch by depth, not by z-buffer.** Stars are emitters, not opaque
geometry. The star pass renders emission and depth into a target; the raymarch adds each star's
contribution at the sample where the ray crosses its depth, attenuated by the transmittance
accumulated so far.

One fetch per ray, and it buys the physical claim outright: a star behind three magnitudes of cloud
is dimmed by three magnitudes of cloud, using the same κ as the illumination so the two cannot
disagree. It is the reason young clusters are infrared sources, shown rather than captioned.

**10. Temporal accumulation, and reduced motion becomes the *sharpest* path.** Jittered samples
accumulate into a float target while view and parameters are static, resetting on any change; the
112-step dither noise converges away and the effective step count goes into the thousands.

Under `prefers-reduced-motion` nothing ever invalidates the buffer, so that path converges to a
cleaner image than the animated one. Reduced motion is normally a degradation; here it is the best
the renderer looks.

**11. Tone mapping applies to the composite only.** The yt-style log colorbar is *already* a
transfer function; bolting ACES on top double-maps it and quietly crushes the density mapping the
science depends on. The colorbar stays the density→emission law untouched, rendering happens in
linear HDR, and tone mapping runs last.

Consequence to watch: if the page ever shows a colorbar legend, that legend must go through the
identical tone map or it will describe a mapping the image does not use. Same lesson as
`figures.json` — one fact, one source.

**12. The illumination equations live in Layer 0 as pure TypeScript.** Grey opacity, cell-to-source
optical depth, 1/r² falloff, transmittance composite: written once in `core/`, tested in node, with
the TSL graph as the mirror that parity checks against it.

This is not new policy. It is the trade already accepted for the starfield — every equation written
twice, permitted **on condition that divergence is detected rather than merely unlikely**. The
`DEFAULT_AUREOLE` bug (amplitude 0.06 in `core/optics`, 0.012 in the shader) is what happens when
that condition lapses into discipline.

## What the export got wrong

Found while deriving the density units, which rung 1 needs and which `meta.json` does not record —
`volume_encoding` says "uint8 log10(rho) rescaled 0..255" and stops.

Mass closure recovers it. Decoding each cube and integrating over the box against
`env_m_cloud_actual_msun`:

```
name                 mach   ratio %cells@floor %mass@floor  ratio_excl_floor
diffuse               3.8  0.9991        70.28        2.54            0.9737
orion                13.1  1.0326        78.66        5.92            0.9714
compact              32.8  1.0974        86.74       11.71            0.9689
orion-solenoidal     13.1  1.0168        74.93        4.33            0.9727
orion-compressive    13.1  1.0767        84.93        9.98            0.9692
orion-shallow        13.1  1.0141        75.38        4.07            0.9728
```

**ρ is in M☉/pc³** — now a derivable, gateable fact rather than an assumption.

**Empty space is not empty.** Everything below `volume_log_min` is clamped *up* to the floor rather
than to zero, and 70–87% of cells sit outside the truncated cloud. Their mass is fictitious and
runs 2.5% → 11.7%, growing with Mach because a wider lognormal puts more volume in deep voids.
Quantization does not explain it: uint8 over 6.00 dex gives 0.0235 dex steps and a log-space
rounding bias on the mean of about 0.01%, three orders too small.

**Subtract the floor and every realization lands at 0.969–0.974** — a 0.5% spread across a factor
of 9 in Mach. That consistency is the signature of a resolution effect: 128³ under-integrating a
cuspy EFF profile. Expected, and not a defect.

This matters to rung 1 directly and not only to bookkeeping. Optical depth from the raw cube picks
up the floor density in every cell along every ray — a uniform grey haze filling the box, worst in
`compact`, which has the most dynamic range and would look the most impressive. An illumination bug
that makes the showpiece realization look atmospheric is one nobody reports.

**Second defect: `volume_log_median` and `volume_log_mean` do not describe the shipped cube.** For
orion, meta says median 1.726 while the cube's median is 0.866, which is exactly `volume_log_min`;
meta says mean 2.640 while mean-of-log is 1.074 and log-of-mean is 1.989. The mismatch holds for
all six realizations, so it is a definition in the exporter and not a one-off.

The cube's median *being* the floor is itself correct — the cloud truncates at r_t inside a larger
box. The problem is that the recorded statistic measures something else while its name asserts
otherwise, and `scene.ts` feeds it straight in as the renderer's default display floor. The picture
looks fine, so nothing has ever failed. The name is what is wrong.

Both are filed for a progenax re-export, together with the already-known `local_density.f32`
saturation (77% of stars at one value) from the same script.

## Gates

Everything in this plan fails silently and looks plausible, which is the case for gating it
rather than reviewing it.

| gate | runs | catches |
| --- | --- | --- |
| mass closure `ratio_excl_floor ∈ [0.96, 0.98]`, floor cells excluded | node, prebuild | a re-export moving the density normalization |
| captured luminosity fraction ≥ threshold, per realization | node, prebuild | top-N silently dropping light as star counts change |
| τ = 0 for an all-floor cube | node, unit | the grey-haze bug, before it can look atmospheric |
| three's projection vs `projectToUv` | node, prebuild | gas and stars drifting apart |
| κ normalization has a recorded locator | `check-constants` | a number typed from memory |
| TSL vs TS reference, **both backends** | browser, own CI job | the port diverging from the physics |
| N accumulated frames ≡ one N-sample render | browser, parity | accumulation biasing the image |

The closure bound is set on `ratio_excl_floor` and not on the raw ratio, which varies by 10% and is
mostly an export artifact. It also survives the repair, which matters more than tightness — a gate
that fails once you fix the bug it was watching is a gate people delete. If the exporter adds a
zero sentinel, `v == 0` still means empty; if it widens the log window instead, those cells decode
to negligible density and excluding them changes nothing.

Nothing GPU-dependent goes in `prebuild`. The deploy must not require an adapter to exist.

**The parity harness already knows its own traps** and they are not hypothetical: WebGPU reads back
top-down and WebGL2 bottom-up, and getting it wrong produced *correct total energy with a 36×
worst-case spatial error* —

```
webgpu   energyRatio 0.999306   median  0.092%
webgl2   energyRatio 0.999306   median 94.806%
```

— which is why the comparison is an image comparison at a percentile, never a summary statistic and
never a maximum. One trap is new here: the raymarch jitters its start offset by a hash of
`gl_FragCoord`, two implementations will not agree on that hash, and parity would be comparing
noise. The jitter gets a parity mode that zeroes it.

## The UI/UX items, reframed

Carried over from the review that started this work, with what the renderer changes about each:

1. **Control density.** Pills, play, scrub, channel chips, recipe chips, two sliders and coupling
   chips in one undifferentiated column. Census groups and progressively discloses; this does not.
   The new pressure is that this work will *tempt* new knobs, and it should not get them —
   illumination parameters are derived exactly as `windLeak` and `fTrap` are, so they belong
   nowhere near the URL. The one arguable exception is a lighting on/off toggle, which earns its
   place only if it teaches.
2. **Contextual controls.** Dynamics hides its binary tab when there is nothing to show. Here the
   coupling chips and C_f are meaningless with winds off, and the H II slider is meaningless when
   the region is trapped, and all of them stay live.
3. **Presets.** Census has a named-URL preset row. The corners worth naming here now include
   `diffuse` lit by one star against `compact` lit by fifty-five — a preset that makes a point
   rather than restoring a state.
4. **The canvas.** Feedback is the only one of the three engines with no sizing rule of its own:
   census and dynamics each cap at `76rem` with an explicit `aspect-ratio`, while feedback's canvas
   inherits whatever `PresentFrame`'s stage gives it. Whether it is actually under-resolved is to be
   **measured at 1512×857 before anything is changed**, not asserted from an earlier note.

## The risk that is new, and largest

There will be **two model rungs on one page**: the illumination's and the feedback budget's. They
are not the same model, and they will be coupled on screen, because the ledger's trajectory drives
the expulsion the render shows. A reader watching a lit cavity open up will very reasonably
conclude that the picture *is* the calculation.

It is not. The budget is a ledger of channel momenta; the render is grey single-scattering over an
exported density cube. Both are honest. Conflating them is not, and separating them is a
`site-claims` obligation rather than a caption-polish one.

## Staging

Each step verifiable before the next.

1. Pin `/explore/dynamics`'s visual baseline. **Nothing else starts until this exists** —
   refactoring `clusterPoints` to accept an external renderer is the single largest regression risk
   here, and `shaders-baseline.json` is the precedent for pinning.
2. Scene host; `clusterPoints` takes an external renderer. Dynamics unchanged, proven against the
   pin.
3. TSL volume port; parity against `viz/webgl` on both backends. Same picture, new stack.
4. Mass-closure and captured-fraction gates; κ normalization sourced with locators.
5. Rung 1 — Layer 0 reference first, TSL mirror second, parity between them.
6. Presentation tier: deep compositing, accumulation, HDR.
7. Rung 2, labelled separately.
8. UI/UX pass, and the copy separating the two rungs.
9. Card the page, removing all four holds together: `noindex`, the sitemap filter in
   `astro.config.mjs`, `EXCLUDED` in `scripts/search/build-index.mjs`, and `HELD_BACK` in
   `scripts/check-explore.mjs`.

Steps 1–3 carry the regression risk. Steps 4–5 carry the honesty risk.

## Open

- **ψ ≈ 3.2 (computed) vs ψ = 1 (published relations) vs ψ_eff ≈ 1.5 (implied by Lopez's 30 Dor
  measurement)** — documented in `docs/feedback-derivations.md` §O, unresolved, and untouched by
  this plan.
- The ~5× disagreement between KM09's porous-bubble analysis and Lancaster+2025's measured α_p,
  gated so it cannot be tuned away.
- Whether the WebGL2 fallback keeps rung 1 at reduced cost or drops to the rung-0 look. Deferred
  until stage 3 measures what the fallback can actually sustain; deciding it earlier would be
  guessing at a number.
