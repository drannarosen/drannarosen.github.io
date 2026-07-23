# Feedback Budget — design

> Status: design, validated in brainstorm 2026-07-23. **v3** — modeling choices
> hardened: per-channel coupling (no `ε`), leakage locked to the momentum boost,
> and the realization axis changed from a Mach ladder to physical ENVIRONMENTS
> after measuring that Mach is both a logarithmically-weak and a CONFOUNDED lever.
> Next: regenerate the environment set, then the implementation plan.
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
- **Interactivity = the feedback knobs + an environment picker.** Channels on/off
  and the per-channel leakage/trapping knobs are live (computed in-browser from
  the fixed population). Variety = switch pre-generated environments. No live IMF
  slider — the teaching is about the channels and the budget, not re-sampling the IMF.
- **No `ε` for coupling — the symbol is taken.** The realizations already carry an
  SFE (`sfe_ic = 0.2`), and ε reads as star-formation efficiency to this audience.
  Coupling is per-channel and named for its mechanism (`f_leak`, `f_trap`); `ε_SF`
  is reserved for the SFE, which is a fixed property of the realization, not a knob.
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

## Modeling choices — hardened in the 2026-07-23 brainstorm

### Per-channel coupling, because the channels fail for different reasons

One global efficiency would impose a single failure mode on three unrelated
mechanisms. Each channel gets a parameter named for its own physics:

| channel | why it under-couples | parameter |
| --- | --- | --- |
| stellar winds | shocked hot gas cools and vents through low-density channels | `f_leak` |
| photoionization | HII gas champagne-flows out instead of pushing the cloud | `f_leak` |
| radiation pressure | IR photons escape low-column channels instead of being trapped | `f_trap` (τ_IR) |

### Leakage drives BOTH bars — one knob, no contradictory states

Cooling/venting is one physical process: when the hot gas radiates or escapes,
the thermal energy is lost AND the PdV work that was boosting the shell stops.
Exposing energy-retention and the momentum boost η as independent sliders admits
states with no physical referent (η = 50 with 95 % of the energy radiated), so
they are locked to a single per-channel leakage parameter:

```
f_leak ∈ [0,1]
E_ret  = (1 − f_leak) · E_inj
η      = 1 + (η_max − 1) · (1 − f_leak)      # momentum boost
p_ret  = η · p_inj
```

Limits are exact: `f_leak = 0` → adiabatic (full energy, maximum boost);
`f_leak = 1` → radiative (no energy retained, η = 1, momentum-conserving). The
**interpolation between those limits is a parameterization, not a derivation**,
and must be labelled as such on the page. `η_max` is sourced per channel — it is
left unset until the reference is pinned rather than filled with a plausible number.

### Independent η is a v2 feature, because it is time-dependent

Momentum has memory: impulse already delivered is not un-delivered when the
bubble later vents. That is inherently a statement about history, and **v1 is a
static snapshot — there is no "before"**, so an independent η in v1 would be a
free parameter with nothing determining it. In v2 the decoupling falls out of the
integration with no new knob: `p(t) = ∫ η(t)·ṗ dt` accumulates while
`E(t) = (1 − f_leak(t))·E` collapses when cooling switches on.

Note v1 already contains both coupling modes, assigned by physics rather than by
a toggle: radiation pressure has no hot phase, so it never obeys the f_leak↔η
lock at all.

### Leakage is gas-structure dependent — and the statistic matters

Leakage is not only venting; **turbulent mixing at the bubble/cloud interface is
likely dominant** (mixing layers raise density and dump the thermal energy
radiatively), and direct cooling scales as n². All three scale with density
structure, so `f_leak` should default from the realization rather than sit at an
arbitrary value.

The right statistic is the width of the gas density PDF, σ_s where s = ln(ρ/ρ̄).
**Measured from the shipped cubes** (128³, profile-subtracted to isolate the
turbulent fluctuation from the smooth EFF gradient; robust across 16/32/64/128
radial bins):

| realization | ℳ | σ_total | σ_turb |
| --- | --- | --- | --- |
| calm | 4 | 1.890 | 0.791 |
| fiducial | 8 | 1.598 | 0.915 |
| turbulent | 12 | 1.424 | 0.941 |

Two traps this measurement caught, both of which would have shipped a backwards
number:

- **σ_total DECREASES with ℳ** (1.890 → 1.424). The fixed EFF profile dominates
  the total and stronger turbulence stirs out the central concentration faster
  than it adds fluctuation. The p90/p10 contrast of local density at star
  positions is backwards for the same reason. Only the profile-subtracted
  σ_turb moves the right way.
- **σ_turb barely separates the top rungs** (0.915 → 0.941, +3 %), and that is
  not a data artefact: σ_s = √ln(1 + b²ℳ²) grows only LOGARITHMICALLY, so
  ℳ = 12 → 50 buys +34 %. Mach is a weak lever on structure.

### Why the realization axis is NOT Mach

Beyond the logarithmic returns, **ℳ is not an independent knob — it is the
boundness.** σ_v = ℳ·c_s sets the kinetic energy, so ℳ and α_vir are locked; the
shipped metadata shows it (`q_virial` 0.004 → 0.008 → 0.013 across the ladder).
Raising ℳ to widen the density PDF simultaneously unbinds the cloud, which is the
very quantity the ledger exists to explain. `b` (the forcing mixture) is the clean
structural knob: it changes σ_s at FIXED kinetic energy and fixed α_vir
(at ℳ = 8, b = 0.33/0.5/1.0 → σ_s ≈ 1.44/1.68/2.04).

## Realizations = ENVIRONMENTS, parameterized by (M_cloud, R)

`N` is not free — the export already ties it to the cloud
(`n_stars = 10⁴` → `M⋆ = 3883 M☉` ⇒ ⟨m⟩ ≈ 0.39 M☉, `M_cloud = M⋆/SFE`). And Σ
alone does not decide the verdict, since at fixed Σ a larger cloud has a higher
escape speed (v_esc ∝ √(ΣR)). So a realization is specified by **(M_cloud, R)**,
with Σ, N, v_esc and α_vir REPORTED as derived diagnostics.

| environment | M_cloud [M☉] | R [pc] | Σ [M☉/pc²] | N | v_esc [km/s] |
| --- | --- | --- | --- | --- | --- |
| diffuse / low-mass | 2×10³ | 3.0 | 71 | ~1 000 | 2.4 |
| Orion-like (fiducial) | 2×10⁴ | 2.5 | 1 018 | ~10 000 | 8.3 |
| massive compact / YMC progenitor | 1×10⁵ | 2.0 | 7 958 | ~51 000 | 20.7 |

**The thesis is the v_esc column.** Photoionized gas has a sound speed ~10 km/s,
so photoionization can only drive material out while v_esc ≲ 10 km/s. The three
environments straddle that threshold: the diffuse cloud is dispersed easily,
Orion-like sits right at the boundary (which is why it is the contested case),
and in the massive compact cloud the HII region is TRAPPED — photoionization
cannot unbind it, radiation pressure must, and if it cannot, a bound cluster
forms. So the tool teaches **which channel is even capable of the job in this
environment**, not merely whether the total clears a bar.

**ℳ follows from (M, R) by fixing α_vir ≈ 1** (marginally bound, as observed)
rather than being held constant — holding ℳ = 8 would leave the 10⁵ M☉ cloud
wildly sub-virial and unphysical, undermining every number in the ledger. ℳ then
runs ≈ 3.8 / 13 / 33 across the three environments. Structure therefore varies
with environment, which is reality (massive clouds ARE more turbulent), not a
confound; `b` remains the clean structural knob at fixed environment.

**Shipped set = 5 runs:** the three environments, plus b ∈ {0.33, 1.0} at the
Orion-like point (b = 0.5 there is the shared fiducial). ~3.5 MB each
(`volume.u8` is grid-fixed at 2 MB; `stars.f32` ≈ 1.2 MB at N = 51 000),
lazy-loaded per selection. A true SSC (M ~ 10⁶ ⇒ N ~ 5×10⁵ ⇒ 12 MB) is too heavy
to render honestly and is deliberately out of v1 rather than silently subsampled.

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

Every magic number gets a provenance comment. **Nothing below is filled in from
memory** — each is left unset until the reference is checked. To source:
- Q(Teff, L) ionizing calibration (Vacca et al. / Sternberg et al.)
- α_B case-B recombination; Strömgren R_S
- Ṁ(L, Teff, Z) and v∞ wind scalings (Vink et al.)
- radiation-pressure τ_IR treatment (ORION2-informed)
- binding-energy coefficient α for the EFF cloud
- **η_max per channel** — the adiabatic/Weaver bubble solution for winds, the
  D-front solution for photoionization. The f_leak→η interpolation is labelled a
  parameterization on the page.
- **the ~10 km/s ionized-gas sound speed threshold** for HII confinement, and the
  M–Σ regime framing (which mechanism dominates where). Both are real literature
  results, but were stated from background knowledge in the brainstorm and must
  be verified and cited before appearing on the page.
- **mixing-driven cooling** collapsing energy-driven wind bubbles in turbulent
  media — the basis for tying f_leak to σ_turb. Verify before citing.
- (v2) Weaver energy-driven bubble R(t); SN energy 1e51 erg

Validate aggregate feedback vs. Anna's codes / literature (progenax / ORION2 /
HARM² regime), following the IMF/EFF fixture discipline.

## Data pipeline — the realization set (DONE)

`scripts/gravoturb/export_cluster.py` is now a parameterized pipeline: a
`Realization` config (seeds + cloud/geometry/velocity knobs), decomposed export
helpers, `meta` read back from the spec objects (no double-typing), per-realization
folders + a top-level `manifest.json` the picker reads. The Mach-8 fiducial writes
to the root path, so Birth/Gas-expulsion are unchanged (verified byte-identical).

**The shipped Mach ladder (calm/fiducial/turbulent) is SUPERSEDED** — see
"Realizations = ENVIRONMENTS" above. It stays on disk until the environment set
is generated, because `/data/gravoturb` (root, fiducial) is what Birth and
Gas-expulsion currently load; the root path must keep resolving through the swap.

The pipeline itself needs no rework — `Realization` already carries the fields
the environment set needs. The regeneration is a rewrite of the `REALIZATIONS`
list plus a re-run:

- **(M_cloud, R)** drive each entry; `n_stars = SFE·M_cloud/⟨m⟩` and the EFF
  geometry (`eff_a`, `eff_r_t`) follow, rather than being typed independently.
- **ℳ is derived** from α_vir ≈ 1 for that (M, R) — NOT a hand-set constant, so
  no environment is left unphysically sub-virial.
- Σ, N, v_esc, α_vir are written to `meta.json` as derived diagnostics the UI
  reads (never retyped into the page — one source of truth per fact).
- σ_turb should be **measured from each generated cube** and recorded in
  `meta.json`, so `f_leak` defaults from a number in the data rather than a
  constant in the code. (Measurement method: decode `volume.u8` → ln ρ, subtract
  the spherically-averaged radial profile, take the σ of the residual.)

## Build sequence (for the plan)

1. ~~**Merge foundation**~~ — **DONE** (ADR 0013). The WebGL engine, the Plummer
   hero and the gravoturb art all live under `src/novascope/viz/`; `src/lib`
   holds compat shims. Dedupe **DONE**: the duplicated spectral palette and the
   McLuster Fenwick tree each collapsed to one definition. `spectralRGB` vs
   `teffToRGB` and `attachOrbit` vs `attachInteraction` were deliberately NOT
   merged — different models, not duplicates.
2. **Regenerate the environment set** — rewrite `REALIZATIONS` as the three
   (M_cloud, R) environments + the two b-variants, with ℳ derived from α_vir and
   σ_turb measured into `meta.json`. Root path must keep serving the fiducial so
   Birth/Gas-expulsion are unaffected.
3. **Realization loader + picker** — read `manifest.json`; the picker switches
   environments and reports Σ, N, v_esc, α_vir as derived diagnostics.
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
