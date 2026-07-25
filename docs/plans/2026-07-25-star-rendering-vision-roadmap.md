# Star rendering — vision and roadmap

> **Living document.** This owns *where the star renderer is going and why*. Per-build design
> docs own *what is being built now* and **link here rather than copying** — two documents
> repeating the same paragraph is the drift this project keeps having to design against.
>
> Decisions live in `.adr/`, not here. Where this document states a decision it cites the ADR;
> if the two disagree, the ADR wins and this file is stale.

## What the star renderer is for

Three audiences, and they are not the same job.

**`/star-render-lab` is an instrument, not a page.** It is internal, `noindex`, unlinked, and its
purpose is to let Anna *find* representations — to A/B a display transfer, an effect, a band, a
depth, and decide. It should grow toward **versatility**: more axes, more toggles, more things
that can be turned off to see what they were contributing. Baking in one good-looking default
would remove the thing it is used for.

**`/explore/*` is the output.** Those pages walk a reader from **theory to observations**. Five
already exist — census, cluster, feedback-budget, gas-expulsion, mass-segregation — so a new one
must not re-teach the IMF or cluster birth.

**The homepage hero stays as it is.** Deliberately: it is "nice and not too loud", and the new
work is not to be pushed into it.

Beyond this site, the renderings are destined for **ASTR 201**, **outreach**, **research talks**,
and an **open-source release**. Two constraints follow that do not follow from a web page:

- It must survive being **projected, live, in front of people** — legible at distance, no
  accidental states, no reliance on hover.
- Someone else must be able to **run it without this repository**. That is what
  [[novascope-shared-package]] and ADR 0016 are for.

## The ladder: theory → observation

`colorMode` today is a binary. `population` is rungs 1–3; `photometric` is all of them. That is
why the two modes read as different *claims* rather than different *depths of the same claim*,
and why there is no renderable intermediate to walk through.

| # | rung | what it adds | home |
| --- | --- | --- | --- |
| 1 | population | masses, positions | `core/imf`, `core/cluster` |
| 2 | stellar state | Teff, R, L per star | `core/stellar` |
| 3 | intrinsic colour | spectrum → CIE at unit luminance | `core/colorimetry` |
| 4 | distance | inverse square, *within* the cluster | `viz/starfield/prepare` |
| 5 | extinction | reddening before the filter integrates | *not built* |
| 6 | passband | 30 measured curves, 271 nm – 7.7 µm | `core/photometry` |
| 7 | optics | Moffat PSF, aureole, diffraction spikes | `core/optics` |
| 8 | detector | saturation, bloom | `viz/starfield/scene` |
| 9 | display transfer | twelve conventions | `core/imaging/transfers` |

Rung 4 is where theory becomes observation, and it is the teaching moment: **before it every
star sits at unit distance and you are seeing the population; after it the far side of the
cluster dims and you are seeing an image.** Absolute magnitude stays put while apparent
magnitude moves — which is the absolute-vs-apparent lesson, live, with no extra machinery,
because `stats.absMag` is already documented as a property of the stars rather than of the
exposure or the framing.

Exposing this as an axis is ADR 0016's second decision, extending ADR 0012 item 4
("no instrument ladder … *yet*").

## The physics that constrains every design choice here

Not opinions — measured, and asserted by gates. A design that ignores these produces a pretty
picture of something untrue.

- **10 stars carry 48% of the light; 100 carry 92%** — and they are the hot blue ones, while
  **88.5% of the cluster is sub-solar**. Any *photometric* image of a young cluster is therefore
  blue, and that is the physics, not a bug. Per-star blue fraction 0.065; light-weighted 0.189.
- **Band choice cannot restructure a ZAMS image.** Spearman ρ = **1.00000** between per-star flux
  in every band from 271 nm to 7.7 µm, because mass fixes both Teff and radius. Filters change
  tint, never which stars look prominent. `check:star-optics` asserts this **as a fact expected
  to stop being true** when rungs 2 or 5 gain evolved stars or differential extinction — so that
  gate is a deliberate tripwire, and the day it fails is the day the model stops being a ZAMS toy.
- **Population mode is not what a telescope sees**, and must never be labelled as such. It takes
  scheme hue at *unit luminance* and discards the flux ratios, which is precisely why the other
  9,900 stars become visible.
- **The background is real signal** — the summed wings of every star's PSF — not noise. So "make
  it black" is a subtraction problem, not a brightness problem.

## Where the visual ceiling actually is

The rule (memory: `no-cosmetic-hacks`, ADR 0015) is that physical features come from the model,
not from render tricks. Applied honestly, most of the available "movie quality" is physics:

**Worth building.**
- **Pixel-integrated PSF.** The Moffat is point-sampled at pixel centres today. Integrating it
  over the pixel footprint is strictly better quadrature *and* removes the shimmer that makes
  subpixel point sources look cheap. The largest single visual win, and not a trick.
- **A derived sky and a real toe.** Deep blacks are most of what reads as cinematic. `skyLevel`
  defaults to 0 because the right level is not derivable *a priori* (97× spread across configs,
  against 1.45× for the white point) — but it is derivable *per frame* as a low percentile of the
  rendered pixels. That turns a knob into a measurement.
- **Parallax rather than spin.** Slow lateral drift gives depth perception; `autoRotate` is a
  turntable, and rotation is the one motion that hides 3D structure. Spin stays available as an
  option, not the default.
- **Supersampling (`SSAAPassNode`).** For isolated point sources, only *sampling* fixes aliasing —
  morphological AA (FXAA/SMAA) looks for edges, and a star field has none. Costs N renders per
  frame.

**Rejected, and why.** `LensflareNode`, `DepthOfFieldNode`, `ChromaticAberrationNode`, `FilmNode`
— decoration. A cluster at 400 pc has no depth of field. The aureole and diffraction spikes
already in `core/optics` are the *physical* version of what a lens flare imitates, and they are
measured against a CPU reference.

**Bloom is allowed** because it is the sensor's response to a saturated source and it keys on
display white. Anything strong enough to notice on a non-clipping star means the threshold is
wrong.

## Roadmap

Ordered by dependency, not by appetite. One at a time.

1. **URL state for every control.** Small, and it unlocks the rest: a talk becomes bookmarks, a
   class gets a link per concept, a research figure becomes reproducible, an open-source bug
   report arrives as a URL. Also an outstanding ADR 0012 commitment — "One canonical cluster =
   `(seed, params, t)` … Reproducible and URL-shareable". Presets are then just named URLs.
2. **Black background.** Derive the sky per frame; add a black point/toe. Anna's actual complaint,
   and the thing that most changes how the image reads.
3. **Pixel-integrated PSF.** The visual ceiling, and better physics.
4. **Motion.** Parallax default, spin optional.
5. **Effect toggles.** Each optical term on/off, so the lab can answer "is this earning its place?"
6. **Distance and absolute/apparent magnitude as controls.** Rung 4 becomes real; the magnitudes
   lesson falls out.

**Later, and noted here so the architecture is not surprised by it.** Each is a new rung or a
time axis on an existing one — none forces a restructure, which is the main evidence the ladder
framing is right:

- **Dynamics** — leapfrog in novascope (ADR 0016), not a gravax trajectory. Rung 1 gains time.
- **Stellar evolution** — startrax tracks. Rung 2 gains time; this is ADR 0012's `star(M, Z, t)`
  backend ladder reaching its second rung.
- **Extinction** — rung 5, currently absent.
- **Gas expulsion** — couples the two time axes; gravoturb + progenax + fluxax.

**One thing to design for now rather than retrofit.** A time axis breaks the exposure. The white
point is calibrated once per rebuild from a static population; recalibrating per frame while
stars move or evolve would make the exposure **pump** — the exact failure the calibration was
introduced to prevent for camera motion. Calibrate on a reference epoch and hold it. Cheap now,
expensive later.

## Open

- **Task #16** — the status line reports "N above threshold" and "faintest m_bol" from
  `asinhResponse`, which may not be the transfer in use. Confirmed live on 2026-07-25: with
  Lupton selected it read "175 above threshold (11.7%)", a count for a curve it was not applying.
- **Ask 2** (not started) — Lupton variants that keep hue through saturation *and* gain a
  photographic shoulder. Measured motivation: hue spread from faint to near-white pixels rises
  1.60× under Lupton and falls to 0.36× under AgX. Lupton's weak point is its *ending* — a hard
  `rgb / max(peak, 1)` clip where a film shoulder would roll off — not its curve.
- **Sky and bloom re-prepare needlessly.** Both are pure display uniforms; making them skip
  `prepareStarField` would make those sliders instant. A change to `StarLab`'s surface.
