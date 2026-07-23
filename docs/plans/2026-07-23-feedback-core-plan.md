# `core/feedback` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build novascope's Layer-0 feedback physics — per-star sources, three
channels, the leakage model, cloud binding, and the ledger verdict — as a PURE,
gated module, so the Feedback Budget engine renders numbers that are already
proven correct before any pixel exists.

**Architecture:** `src/novascope/core/feedback/` is Layer-0: no DOM, no WebGL, no
Astro, no fetch. It consumes plain arrays (the realization's per-star
`mass, teff, radius` and the cloud's `meta`) and returns plain numbers. A Node
gate `scripts/check-feedback.mjs` asserts the physics the same way
`check-cluster` / `check-stellar` / `check-imf` do, and joins `prebuild`.

**Tech Stack:** strict TS, relative `.ts` imports (never the `@novascope` alias
inside the package), `node --experimental-strip-types` for the gate,
`pnpm check:novascope` for the boundary.

**Physics provenance:** every coefficient traces to
`docs/plans/2026-07-23-feedback-budget-design.md`, which cites the papers. Read
that doc's "Sourced physics" sections BEFORE writing any number.

---

## The non-negotiable rule for this module

**An unsourced coefficient must be impossible to ship, not merely discouraged.**

Two quantities are still unsourced (`η_max` per channel; the Lopez pressure
coefficients). They are NOT to be filled with plausible values. Task 6 builds a
gate that FAILS the build if any coefficient in the sourced registry lacks a
citation — so a guessed number breaks `pnpm build` instead of quietly appearing
on the page under Anna's name.

Where a coefficient can be **derived instead of cited, derive it.** Two cases
already identified:
- **Cloud binding energy** — do NOT introduce a fitted α for `E = αGM²/R`.
  Integrate the shipped profile: `gas_menc.f32` already tabulates M(<r)/M on a
  radial grid, so `E_bind = ∫ G M(<r) dM / r` is a numerical integral over data
  we ship. No coefficient, no citation needed, exact for the actual cloud.
- **ψ** — `L/(S ε₀)` is computable per star (KM09), never assumed to be 1.

---

### Task 1: Per-star sources — luminosity, escape speed, ionizing rate

**Files:**
- Create: `src/novascope/core/feedback/sources.ts`
- Test: extend `scripts/check-feedback.mjs` (created in Task 6; write assertions as you go in a scratch file, fold them in at Task 6)

**Step 1:** Write `luminosity(teffK, radiusRsun): number` — L in L☉ from the
Stefan–Boltzmann law. Reuse `core/stellar`'s existing relation if one fits;
otherwise implement with the constants already cited there. Do not introduce a
second σ_SB.

**Step 2:** Write `escapeSpeed(massMsun, radiusRsun): number` — v_esc = √(2GM/R)
in km/s, the surface escape speed the Vink recipe needs. Provenance comment: the
G value and its epoch, matching `scripts/gravoturb/export_cluster.py`'s
`G_PC_KMS2_MSUN` (IAU 2015 nominal) — state the unit conversion.

**Step 3:** Write the Sternberg ionizing table as ONE labelled block:
```ts
/* Sternberg, Hoffmann & Pauldrach (2003), ApJ, DOI 10.1086/379506,
   Table 1 (luminosity class V; stellar parameters from Vacca, Garmany & Shull
   1996). log q_H is the SURFACE flux [cm^-2 s^-1]; Q = 4 pi R^2 q_H, so the
   caller supplies its own R rather than importing Vacca's. */
const STERNBERG_V: ReadonlyArray<{ teff: number; logQH: number; logqH: number }> = [ … ];
```
Copy the 15 rows from the design doc. Then
`ionizingRate(teffK, radiusRsun): number` returning Q [s⁻¹]:
interpolate `log q_H` linearly in Teff, compute `Q = 4πR²·q_H`.

**Step 4:** Gate the table at its COOL edge. Below 32,060 K return **0**, not an
extrapolation. Comment why: log Q_H falls >100× across the grid, and
extrapolating past a calibration is what makes a budget non-selective.

**Step 5:** Verify against the table itself — for the O7 row (Teff 41,010,
R = 10.0 R☉), `Math.log10(ionizingRate(41010, 10.0))` must land within ~0.02 dex
of the tabulated `log Q_H = 49.06`. This is a real consistency check: it proves
the q_H→Q conversion and the interpolation agree with the paper's own Q column.

---

### Task 2: Stellar winds — Vink mass loss and terminal velocity

**Files:** Create `src/novascope/core/feedback/winds.ts`

**Step 1:** Write the bistability jump exactly as the paper computes it (NOT
fixed at 25 kK), porting the chain already verified in startrax
(`src/startrax/hurley/sse/winds.py`):
```
sigma_e   = 0.2 (1 + X)                                   # Lamers & Leitherer 1993
Gamma_e   = 7.66e-5 * sigma_e * (L/Lsun)/(M/Msun)         # Vink 2001 eq (11)
log_rho   = -14.94 + 0.85 log10(Z/Zsun) + 3.2 Gamma_e     # eq (23)
T_jump    = 1e3 * (61.2 + 2.59 log_rho)                   # eq (15), kK -> K
```
Each constant gets its equation number in a comment.

**Step 2:** Write `massLossRate(L, M, teff, Z, X): number` — Vink eq (24) hot /
eq (25) cool, selected by `T_jump`, with the `+0.85 log10(Z/Zsun)` term. Use
`v_inf/v_esc = 2.6` (hot) and `1.3` (cool) INSIDE the fit's own
`-1.226|-1.601 · log10((v/vesc)/2.0)` term — the ratio is an input to the fit,
so it must match the ratio Step 3 returns.

**Step 3:** Write `terminalVelocity(vEsc, teff, …): number` → `2.6·v_esc` above
the jump, `1.3·v_esc` below. Comment that substituting a different v_w
prescription (e.g. Leitherer 1992) while keeping this Ṁ breaks the fit's
internal consistency — they travel as a pair.

**Step 4:** Gate at **Teff < 12,500 K ⇒ Ṁ = 0**. Comment that this is the eq-25
calibration floor, that COMPAS extrapolates below it and that doing so is not
paper-faithful, and that this floor is what makes the wind budget selective by
environment.

**Step 5:** Sanity-check in the scratch gate: a 40 kK, 10 R☉, 30 M☉ star must
give Ṁ in the 1e-7–1e-6 M☉/yr range and v∞ of order 10³ km/s (compare Sternberg
Table 1, which lists both for real O stars — an independent cross-check).

---

### Task 3: The three channels

**Files:** Create `src/novascope/core/feedback/channels.ts`

**Step 1:** Define the shared return shape — every channel reports the SAME two
currencies so the ledger can sum them without special cases:
```ts
export interface ChannelOutput { energy: number; momentum: number; }  // erg, g cm/s
```

**Step 2:** `winds(stars)` — sum `p = Ṁ v∞ · Δt` and `E = ½ Ṁ v∞² · Δt`
(Rosen 2022 §2.4.3). Δt is the integration window; make it an explicit argument,
never a hidden constant.

**Step 3:** `photoionization(stars, cloud)` — the KM09 gas-pressure channel.
Total `S = Σ Q_i`. Use their fiducials WITH provenance: `α_B = 3.46e-13 cm³ s⁻¹`,
`φ = 0.73` (McKee & Williams 1997), `T_II = 7000 K`. Note in a comment that
T_II is 7000 K here and NOT 10⁴ K, because it must pair with KM09's own α_B and φ.

**Step 4:** `radiationPressure(stars, fTrap)` — momentum `f_trap · L_tot/c`.
Default `f_trap = 2`, commented as KM09's own fiducial for a parameter they
deliberately leave free, with the meaning of 0 (optically thin) and 1 (one
absorption per photon).

**Step 5:** `characteristicRadius(S, fTrap, …)` — KM09 Eq. (4). This is the
discriminator the engine displays: radiation dominates inside r_ch, gas pressure
outside. Compute ψ = L/(S ε₀) from the population rather than assuming 1.

**Step 6:** Verify the KM09 numerical evaluation reproduces: with their fiducial
parameters, `r_ch` must equal `9.2e-2 · S_49 pc` (spherical) to within a few
percent. This is a strong end-to-end check of Eq. (4) — if the constant folding
is wrong, this catches it.

---

### Task 4: Leakage — one knob, two consistent bars

**Files:** Create `src/novascope/core/feedback/leakage.ts`

**Step 1:** Implement the coupled map exactly as designed:
```
E_ret = (1 - f_leak) · E_inj
eta   = 1 + (eta_max - 1) · (1 - f_leak)
p_ret = eta · p_inj
```
**Step 2:** `eta_max` is UNSOURCED. Do NOT choose a value. Type it as a required
argument with no default, and register it in the coefficient registry (Task 6)
as `unsourced`, so the gate fails until it is cited. Comment that the endpoints
themselves ARE sourced — Fall, Krumholz & Matzner (2010) treat energy-driven and
momentum-driven as the limiting regimes of minimum and maximum radiative losses.

**Step 3:** Write `defaultLeak(sigmaTurb): number` mapping the realization's
measured `sigma_turb` to a default `f_leak`. Comment the justification chain:
Lancaster+21 show mixing at a FRACTAL interface radiates most of the wind energy,
so leakage is set by interface AREA, which structure (σ_turb) tracks and Mach
number does not. Label the mapping a **parameterization, not a derivation**, and
make it monotonic with correct limits.

**Step 4:** Radiation pressure does NOT use this map — it has no hot phase. Its
knob is `f_trap`. Assert this in a comment so a later refactor doesn't unify them.

---

### Task 5: Binding energy and the ledger verdict

**Files:** Create `src/novascope/core/feedback/{binding,ledger}.ts`

**Step 1:** `bindingEnergy(mencFrac, rGrid, mGas)` — integrate
`E = ∫ G M(<r) dM / r` numerically over the SHIPPED `gas_menc` table. No fitted
α coefficient is introduced; the profile we ship is the profile we integrate.

**Step 2:** `escapeMomentum(mGas, vEsc)` — the momentum budget the retained
momentum is compared against.

**Step 3:** `ledger(stars, cloud, knobs)` — assemble per-channel injected →
leaked → retained, sum both currencies, and return BOTH bars plus the verdict.

**Step 4:** The verdict is momentum-keyed with the energy bar shown alongside
(the design's decision). Return a structured result — never a prose string —
so the renderer owns wording:
```ts
{ channels: Record<ChannelName, {injected: ChannelOutput; retained: ChannelOutput}>,
  bound: boolean, rCh: number, vEsc: number, ... }
```

**Step 5:** Verify monotonicity in the gate: raising `f_leak` must never INCREASE
retained energy or retained momentum. A violation means the coupled map was
wired backwards — cheap to assert, and exactly the bug that would look plausible.

---

### Task 6: The gate — and the unsourced-coefficient trap

**Files:**
- Create: `scripts/check-feedback.mjs`
- Modify: `package.json` (`check:feedback`, and add to `prebuild`)

**Step 1:** Build the coefficient registry: every physical constant used by the
module, each with `{value, source}` where `source` is a resolvable citation or
the literal `"UNSOURCED"`.

**Step 2:** Make the gate FAIL if any registry entry is `UNSOURCED` **and** is
reachable from a shipped code path. This is the mechanism that makes a guessed
number break the build rather than reach the page.

**Step 3:** Fold in the physical assertions written during Tasks 1–5:
Sternberg O7 round-trip (±0.02 dex) · KM09 r_ch numerical evaluation · Vink
sanity ranges · the 12,500 K and 32,060 K gates returning exactly 0 · leakage
monotonicity · determinism (same inputs ⇒ identical output).

**Step 4:** Environment ordering — the end-to-end physics check. Across the three
shipped environments, the RATIO of photoionization to radiation-pressure momentum
must FALL as Σ rises. If it doesn't, the channel hand-off the whole engine exists
to teach is not actually happening. Run it against the real shipped `meta.json`
files.

**Step 5:** Wire it up.
Run: `pnpm check:feedback && pnpm check:novascope && pnpm check && pnpm build`
Expected: all green; boundary still reports `core imports nothing but the core`.

**Step 6:** Commit.

---

## Definition of done
- `src/novascope/core/feedback/` is pure Layer-0; the boundary gate is green.
- Every coefficient carries a resolvable citation, or the build fails.
- `η_max` remains unsourced and therefore UNSHIPPABLE — no placeholder value.
- Binding energy is integrated from the shipped profile, not fitted.
- `pnpm check:feedback` runs in `prebuild` and asserts the Sternberg round-trip,
  the KM09 r_ch evaluation, both calibration gates, leakage monotonicity, and the
  environment ordering.
- No renderer, no component, no page — that is the NEXT plan.
