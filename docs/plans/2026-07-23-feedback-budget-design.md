# Feedback Budget — design

> Status: design, validated in brainstorm 2026-07-23. Next step: implementation plan.
> Engine spec: `src/content/explore-plan/engines/feedback-budget.md` (Chapter 9 tool).

## Goal

Make stellar feedback tactile: take the cluster you sampled in the census, and
watch its handful of O stars try to blow the natal cloud apart. Toggle each
channel, dial the coupling efficiency, and read a two-column **energy + momentum
ledger** against the cloud's binding energy — does the cloud **blow out** or
**stay bound**? The feedback carves a real HII region (v1) and, later, an
expanding wind bubble (v2) into the real turbulent gas.

The name is the thesis: it is a *budget*. The accounting is the insight; the
spatial spectacle is how the accounting is made legible.

## Decisions (validated)

- **Source = the census population.** The exact stars sampled in
  `/explore/census` — their per-star L, Teff, mass — aggregate into the
  cluster's ionizing rate, wind power, and radiation force. Feedback answers to
  the same IMF / metallicity / mass knobs. It is the strongest thread in the
  series: the census makes the stars, this shows what those stars *do*.
- **One engine: novascope.** The gravoturb gas is not reused across a two-engine
  seam and not rebuilt — the existing `lib/cluster` WebGL engine is **merged
  into novascope**. novascope gains a WebGL volumetric viz capability alongside
  its canvas-2D renderers. Birth and Gas-expulsion re-platform onto the merged
  engine afterward, retiring `lib/cluster`.
- **Dynamics comes in with the merge.** `lib/cluster` already ships
  `createDynamics` (relaxation/crossing-time evolution) and a segregator — so
  merging *brings dynamical segregation into novascope*; it is not a separate
  future build. v1 does not *use* it (v1 is static), but the capability lands.
- **Channels, versioned.** v1: photoionization, stellar winds, radiation
  pressure. v2: + supernovae (with the time axis + stellar tracks). v3: +
  protostellar outflows.
- **v1 is a static budget.** The time axis is v2. v1 is a snapshot verdict with
  a static HII region drawn over the real gas — no animation yet.
- **Honesty.** Analytic budgets and analytic front radii, every coefficient
  sourced. Not a live radiation-hydrodynamics solve. (Matches the spec.)

## Architecture — merging `lib/cluster` into novascope

`lib/cluster` public surface (`src/lib/cluster/index.ts`): `Scene`/`loadScene`
(progenax volume cube + `stars.f32`), `createEngine` (WebGL), `attachInteraction`,
`spectralRGB`, `makeSegregator`, `createDynamics` / `RELAX_TCROSS`.

**Keep & re-home** (the unique, SOTA parts → novascope Layer-2 viz + Layer-0):
- WebGL volumetric gas renderer + shaders (raymarched log-density cube)
- Scene / volume loader — the real progenax density field + gas metadata
- `createDynamics` — relaxation-time evolution (a capability novascope lacks)

**Converge onto novascope's canonical core** (delete the duplicates):
- `spectralRGB` → `teffToRGB` (novascope `core/stellar`)
- `makeSegregator` → `segregateMasses` (novascope `core/cluster/segregation`);
  keep whichever implementation is better, retire the other
- `attachInteraction` → novascope `viz/camera` (`attachOrbit`)

**Unify the population — the one genuinely-better move.** Today `lib/cluster`
renders the snapshot's *own* stars while novascope IMF-samples its own. Instead:
novascope samples the masses (census IMF), and draws **positions from the
gravoturb density field itself** — a new `gravoturb` spatial profile alongside
Plummer / EFF (`core/cluster/profiles.ts`). The census population then physically
sits in the turbulent gas it would have formed in; one data cube serves both
"where the stars are" and "what the feedback carves."

**Layering** stays disciplined (ADR 0012): Layer-0 core stays pure (gas-data
types, feedback physics, the gravoturb profile sampler); the WebGL renderer is
Layer-2 viz; the boundary gate is unaffected (core imports nothing but core).

This is a real architecture decision → **record an ADR** ("merge `lib/cluster`
WebGL engine into novascope; one cluster engine") when the plan is written.

## v1 — the static ledger + volumetric gas

### Physics: three channels, aggregated over the coeval population

Each channel yields an **energy** and a **momentum**, integrated analytically
over the massive stars' main-sequence phase. Coefficients to be pinned with
citations at build time (astro-code-dev discipline — see Sourcing below).

| channel | injected | from the population |
| --- | --- | --- |
| **photoionization** | HII thermal energy + D-front momentum; sets Strömgren radius R_S | total ionizing rate Q = Σ Qᵢ (Teff/L → Q via a Vacca/Sternberg calibration) |
| **stellar winds** | E_w = ½ Ṁ v∞² integrated; momentum Ṁ v∞ | per-star mass-loss + terminal velocity (Vink-style scaling) |
| **radiation pressure** | momentum L/c, boosted (1 + τ_IR) for reprocessed IR | total L = Σ Lᵢ; τ_IR from the gas column (the ORION2 regime) |

### Ledger

`injected → ε-coupled → retained`, measured against the cloud's binding energy:
- **Coupling efficiency ε** (knob) — fraction that couples to the gas vs.
  radiates/leaks. This is the energy-driven vs. momentum-driven crux.
- **Cloud binding energy** E_bind = α G M²/R, from the gas cube (knob-adjustable).
- **Verdict** — sum retained *energy* and retained *momentum*; if either clears
  its binding budget → **blow-out**, else **stays bound**. Both bars shown
  deliberately: "which one actually unbinds the cloud?" is the tension.

### Visual (v1, static)

Real progenax gas rendered volumetrically (the merged WebGL renderer); the
census population placed by the gravoturb profile, sitting in the gas; a static
HII region (ionization front at R_S) as a volumetric structure; the ledger as
two bar columns beside it, with the binding-energy line and the blow-out/bound
verdict. No animation.

### Controls

Channel on/off ×3 · coupling efficiency ε · cloud binding energy · (inherited
census knobs: IMF slope, N/M, metallicity, segregation — they move the source).

## v2 / v3

- **v2** — the time axis: a cluster-age scrubber; the wind bubble expands
  (Weaver R(t)), the ledger accumulates, and **supernovae** fire at each massive
  star's t_MS. Needs the stellar-tracks rung (Stellar Tracks engine) for the
  late-phase output; SN timing is available from `msLifetime` already.
- **v3** — protostellar outflows (a formation-phase channel; overlaps the Birth
  regime).

## Sourcing — coefficients to pin (astro-code-dev)

Every magic number gets a provenance comment before it ships. To source:
- Q(Teff, L) ionizing-photon calibration (Vacca et al. / Sternberg et al.)
- α_B case-B recombination coefficient; Strömgren R_S formula
- Ṁ(L, Teff, Z) and v∞ wind scalings (Vink et al.)
- radiation-pressure τ_IR treatment (ORION2-informed)
- binding-energy coefficient α for the gas profile
- (v2) Weaver energy-driven bubble R(t); SN energy 1e51 erg

Validate the aggregate feedback quantities against Anna's codes / literature
where a reference exists (the progenax / ORION2 / HARM² regime), following the
fixture discipline used for the IMF and EFF ports.

## Build sequence (for the plan)

1. **Merge foundation** — re-home the WebGL gas engine into novascope
   (Layer-2 viz + Scene/volume loader); dedupe spectral/segregation/camera onto
   novascope core; boundary gate stays green. ADR recorded.
2. **Gravoturb profile** — `core/cluster/profiles.ts` gains a gravoturb
   position sampler drawing from the density cube; the census population places
   into the gas. Validate determinism + that positions track the density field.
3. **Feedback core** — `core/feedback/` : the three channels + ledger +
   binding-energy verdict, pure and gated, coefficients sourced.
4. **Feedback Budget engine** — the Layer-3 component: volumetric gas + placed
   population + static HII + the two-bar ledger + controls.
5. **/explore card** — add "Feedback Budget" (live) once shipped.
6. **Later** — Birth + Gas-expulsion migrate onto the merged engine; retire
   `lib/cluster`. Then v2 (time axis + SNe), then v3 (outflows).

## Open questions / risks

- **Gravoturb-profile physics** — sampling positions ∝ density is what the Birth
  story does illustratively; confirm it is honest enough as a *placement* model
  (stars form in density peaks) or whether it needs the snapshot's own stars for
  strict self-consistency. Decide during step 2.
- **WebGL + canvas-2D coexistence** — the ledger/HRD stay canvas-2D; the gas is
  WebGL. Confirm clean compositing (stacked canvases vs. one context) in step 1.
- **Segregation dedupe** — compare `lib/cluster` `makeSegregator` vs. novascope
  `segregateMasses` before retiring either; keep the validated one.
- **Performance** — volumetric raymarch + a large census population; confirm the
  render budget holds (the existing engine already does this, so mostly a
  re-home concern).
