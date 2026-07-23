# Feedback Budget — design

> Status: design, validated in brainstorm 2026-07-23 (v2 of this doc — source and
> renderer reframed after inspecting the gas data provenance). Next: implementation plan.
> Engine spec: `src/content/explore-plan/engines/feedback-budget.md` (Chapter 9 tool).

## Goal

Make stellar feedback tactile. Take a **real gravoturbulent star-forming cloud**
from progenax — turbulent gas with a cluster of stars embedded in it — and watch
its handful of O stars try to blow the natal cloud apart. Toggle each channel,
dial the coupling efficiency, and read a two-column **energy + momentum ledger**
against the cloud's binding energy: does it **blow out** or **stay bound**? The
feedback carves a real HII region (v1) and, later, an expanding wind bubble (v2)
into the actual turbulent density field.

The name is the thesis: it is a *budget*. The accounting is the insight; the
volumetric spectacle is how the accounting is made legible.

## What the gas+stars data is (provenance)

`public/data/gravoturb/meta.json`: **`progenax gravoturb build_cluster_ic`** — an
*initial-condition generator*, not a frozen hydro snapshot. Parameterized:

- EFF cloud (Elson-Fall-Freeman 1987), truncated: `a=0.8 pc, γ=3, r_t=2.5 pc`
- turbulent density field, `Mach=8`, `c_s=0.2 km/s`; volume cube `volume.u8`
- `n_stars=10⁴`, `M⋆=3883 M☉`, `SFE=0.2`; stars **placed by the turbulent
  density** with a segregation correlation `lambda_corr=0.6`
- per-star export: `x,y,z,mass,teff,radius` + `velocities.f32` + **`local_density.f32`**
  (each star's local gas density — exactly what per-star feedback coupling needs)

**Consequence 1 — no placement hack.** The model already places stars in the gas
self-consistently (density-correlated, segregated). We use the realization's own
stars; novascope invents no placement law.

**Consequence 2 — realizations are cheap.** Because it's a *generator*, more
realizations are a re-run + re-export, offline, seconds each: different seeds
(stochastic variety — star formation is stochastic) and/or a small parameter set
(Mach, cloud mass). The user picks among pre-generated realizations.

## Decisions (validated)

- **Source = progenax gravoturb realizations, NOT the census.** Self-consistent
  gas + embedded stars from `build_cluster_ic`. The census stays its own engine
  (the live IMF sandbox, canvas-2D, no gas); Feedback Budget is decoupled from it.
- **Interactivity = the feedback knobs + a realization picker.** Channels on/off,
  coupling ε, binding energy are live (computed in-browser from the fixed
  population). Variety = switch pre-generated realizations. No live IMF slider —
  the feedback teaching is about the channels and the budget, not re-sampling the IMF.
- **Renderer = all-WebGL, stars embedded in the gas.** Stars must look *inside*
  the volume (depth-interleaved), not composited on top — so Feedback Budget uses
  the WebGL engine that renders gas + stars together (what `lib/cluster` already
  does for the Birth story), re-homed into novascope. The census keeps its
  canvas-2D renderer; the two engines share novascope's core, not their renderers.
- **One engine: novascope.** The `lib/cluster` WebGL engine merges into novascope
  (Layer-2 WebGL viz). Dynamics (`createDynamics`, relaxation-time) comes in with
  the merge. Birth and Gas-expulsion re-platform onto it afterward, retiring
  `lib/cluster`. Record an ADR for the merge.
- **Channels, versioned.** v1: photoionization, stellar winds, radiation pressure.
  v2: + supernovae (with the time axis + stellar tracks). v3: + protostellar outflows.
- **v1 is a static budget.** Time axis is v2. v1 is a snapshot verdict with a
  static HII region carved into the gas — no animation yet.
- **Honesty.** Analytic budgets + analytic front radii, every coefficient sourced.
  Not a live radiation-hydrodynamics solve. (Matches the spec.)

## Architecture — merge `lib/cluster` into novascope

`lib/cluster` public surface: `Scene`/`loadScene` (volume cube + `stars.f32` +
velocities + local density), `createEngine` (WebGL gas + stars), `attachInteraction`,
`spectralRGB`, `makeSegregator`, `createDynamics`/`RELAX_TCROSS`.

**Keep & re-home → novascope Layer-2 viz (+ Layer-0 where pure):**
- the WebGL renderer — volumetric gas raymarch **and its embedded-star rendering**
  (we keep the star half now; embedding is the whole point)
- the Scene / realization loader (volume + stars + velocities + local density)
- `createDynamics` (a capability novascope lacks)

**Converge onto novascope's canonical core (delete duplicates):**
- `spectralRGB` → `teffToRGB`
- `makeSegregator` → `segregateMasses` (the export is already segregated; this is
  for the eventual Birth/Gas-expulsion migration — keep the better impl)
- `attachInteraction` → novascope `viz/camera` (`attachOrbit`)

**Feedback physics is novascope's, applied to the realization's stars.** Each
star's `(mass, teff, radius)` from the export → L = 4πR²σT⁴ → Q, wind power,
radiation force via the sourced relations (below). `local_density.f32` gives each
massive star's local n for a spatially-resolved Strömgren radius.

Layering stays disciplined (ADR 0012): Layer-0 core stays pure (feedback physics,
realization data types); the WebGL renderer is Layer-2 viz; boundary gate green.

## v1 — the static ledger + volumetric gas

### Physics: three channels, aggregated over the realization's population

| channel | injected | from the stars |
| --- | --- | --- |
| **photoionization** | HII thermal energy + D-front momentum; Strömgren radius R_S | total Q = Σ Qᵢ (Teff/L → Q, Vacca/Sternberg); local n from `local_density` |
| **stellar winds** | E_w = ½ Ṁ v∞² integrated; momentum Ṁ v∞ | per-star Ṁ, v∞ (Vink-style) |
| **radiation pressure** | momentum L/c, boosted (1+τ_IR) for reprocessed IR | total L = Σ Lᵢ; τ_IR from the gas column (ORION2 regime) |

### Ledger

`injected → ε-coupled → retained`, measured against the cloud's binding energy:
- **Coupling efficiency ε** (knob) — couples to gas vs. radiates/leaks. The
  energy-driven vs. momentum-driven crux.
- **Cloud binding energy** E_bind = α G M²/R, from the realization's gas.
- **Verdict** — sum retained *energy* and retained *momentum*; if either clears
  its binding budget → **blow-out**, else **stays bound**. Both bars shown: "which
  one actually unbinds the cloud?" is the tension.

### Visual (v1, static)

All-WebGL: the real turbulent gas raymarched, the realization's stars **embedded**
in it (depth-interleaved), a static HII region carved into the volume at R_S. The
ledger sits beside the scene (canvas-2D/DOM) as two bar columns with the
binding-energy line and the blow-out/bound verdict. No animation.

### Controls

Channel on/off ×3 · coupling efficiency ε · cloud binding energy · **realization
picker** (which pre-generated cloud). No census IMF sliders.

## v2 / v3

- **v2** — time axis: a cluster-age scrubber; the wind bubble expands (Weaver
  R(t)), the ledger accumulates, **supernovae** fire at each star's t_MS. Needs
  the stellar-tracks rung for late-phase output; SN timing from `msLifetime`.
- **v3** — protostellar outflows (formation-phase; overlaps the Birth regime).

## Sourcing — coefficients to pin (astro-code-dev)

Every magic number gets a provenance comment. To source:
- Q(Teff, L) ionizing calibration (Vacca et al. / Sternberg et al.)
- α_B case-B recombination; Strömgren R_S
- Ṁ(L, Teff, Z) and v∞ wind scalings (Vink et al.)
- radiation-pressure τ_IR treatment (ORION2-informed)
- binding-energy coefficient α for the EFF cloud
- (v2) Weaver energy-driven bubble R(t); SN energy 1e51 erg

Validate aggregate feedback vs. Anna's codes / literature (progenax / ORION2 /
HARM² regime), following the IMF/EFF fixture discipline.

## Data pipeline — the realization set (DONE)

`scripts/gravoturb/export_cluster.py` is now a parameterized pipeline: a
`Realization` config (seeds + cloud/geometry/velocity knobs), decomposed export
helpers, `meta` read back from the spec objects (no double-typing), per-realization
folders + a top-level `manifest.json` the picker reads. The Mach-8 fiducial writes
to the root path, so Birth/Gas-expulsion are unchanged (verified byte-identical).

Shipped v1 set — a controlled **Mach ladder** (seeds fixed, only turbulence
varies), so the picker teaches: calm → filamentary, and the cluster becomes less
bound (Q rises with σ = ℳ·c_s):

| name | Mach | Q (T/|W|) | path |
| --- | --- | --- | --- |
| calm | 4 | 0.004 | `/data/gravoturb/calm` |
| fiducial | 8 | 0.008 | `/data/gravoturb` (root) |
| turbulent | 12 | 0.013 | `/data/gravoturb/turbulent` |

~2.7 MB each (lazy-load per selection). Adding more (seeds, a cloud-mass axis) is
now a one-line edit to `REALIZATIONS` + a re-run.

## Build sequence (for the plan)

1. **Merge foundation** — re-home the `lib/cluster` WebGL engine (gas + embedded
   stars + scene loader) into novascope Layer-2; dedupe spectral/segregation/camera
   onto core; boundary gate green; ADR recorded.
2. **Realization loader + picker** — load a set of `build_cluster_ic` exports;
   a picker switches them. (Anna generates the extra realizations in progenax.)
3. **Feedback core** — `core/feedback/`: three channels + ledger + binding-energy
   verdict, pure and gated, coefficients sourced; local-density-resolved R_S.
4. **Feedback Budget engine** — Layer-3 component: WebGL embedded scene + HII
   carving + two-bar ledger + controls (channels, ε, binding, realization picker).
5. **/explore card** — add "Feedback Budget" (live) once shipped.
6. **Later** — Birth + Gas-expulsion migrate onto the merged engine; retire
   `lib/cluster`. Then v2 (time axis + SNe), then v3 (outflows).

## Open questions / risks

- ~~Realization set~~ — RESOLVED: a 3-point Mach ladder (calm/fiducial/turbulent),
  shipped. Add seeds or a cloud-mass axis later if the picker wants more.
- **HII carving in WebGL** — v1 draws a static ionization front in the volume;
  confirm the shader approach (a radius mask / second raymarch pass) in step 1/4.
- **Segregation dedupe** — compare `lib/cluster` `makeSegregator` vs. novascope
  `segregateMasses` before retiring either (only matters for the Birth migration;
  the realization export is already segregated).
- **Performance** — volumetric raymarch + 10⁴ embedded stars already runs in the
  Birth engine, so mostly a re-home concern; re-verify after merge.
- **Stellar properties** — use the export's `teff/radius` (progenax's own) for the
  feedback, not a novascope re-derivation, so the stars stay the model's.
