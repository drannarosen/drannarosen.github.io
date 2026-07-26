# Dynamics and extinction labs — design

**2026-07-26. Design only; no code exists yet.** Approved section by section by Anna in the
session that produced it. Decisions belong in `.adr/`; where this document states one it cites
the ADR. Where the two disagree, the ADR wins and this file is stale.

Two internal pages, both `noindex` and unlinked, in the mould of `/star-render-lab` —
instruments for finding representations, not published pages:

- **`/dynamics-lab`** — a real symplectic leapfrog integrator, with two force models.
- **`/extinction-lab`** — dust reddening, rung 5 of the theory→observation ladder, and the
  only rung the roadmap marks *not built*.

Neither touches a shipped `/explore` page.

---

## Part I — Dynamics

### The finding that shaped this half

`core/dynamics/index.ts` is described in the 2026-07-26 audit as the pattern ADR 0016 decided
against. That is true of its **inputs** and false of its **integrator**. Lines 390–404 are a
KDK leapfrog with sub-stepping, and the constants above them carry measured energy-drift
provenance (−4.9e-3 at 100 sub-steps, −1.6e-4 at 200, +2.1e-4 at 400).

What distinguishes it is the **force model**, not the quality of the integration. `computeAcc`
reads one scalar per star:

```ts
const r = radius[i];
const k = binOf(r);
const mIn = mEnc[k] + mg * fEncBin[k];
acc[i * 3] = f * p[i * 3];          // always parallel to the position vector
```

That is Newton's shell theorem over a spherically-averaged density — a mean-field solver, as
the file's own header says: *"a 1-D spherical particle-mesh ('shell') code."* Three
consequences follow, and none is an accuracy limit:

- **Every force is central.** No torque exists in the solver, so per-star angular momentum is
  conserved by construction rather than as a result.
- **Two stars at the same radius feel identical accelerations.** Two-body relaxation and
  dynamical mass segregation have no term. The header says so and cites the standard treatment
  (Hills 1980; Lada, Margulis & Dearborn 1984; Baumgardt & Kroupa 2007).
- **Cost is O(N), not O(N²).** At N = 10,000 a direct force call is ~5.0 × 10⁷ pair
  evaluations against ~2 × 10⁴ for binning and lookup.

The two solvers converge to different answers in the limit of infinite accuracy. The mean-field
one solves the collisionless Boltzmann equation, which genuinely has no relaxation term; direct
summation solves the N-body problem, where relaxation emerges from the pair sum. This is a
modelling choice, not a numerical one.

### Decision: carry both, under one domain

**Anna's call, 2026-07-26.** Both force models ship, sharing one integrator. That is stronger
than either alone: the lab can run them on identical initial conditions, and the difference
between the two images *is* the collisional/collisionless lesson.

```
core/dynamics/
  types.ts          ForceModel, State, Diagnostics
  integrate.ts      KDK leapfrog — shared; knows no physics
  ic.ts             initial conditions from core/imf + core/cluster
  diagnostics.ts    E, L, Q, r_h, Lagrangian radii, bound fraction
  direct/           pairwise O(N²), Plummer softening   — collisional
  meanField/        spherical binned M(<r)              — collisionless
  gasExpulsion/     today's index.ts, re-homed (see order of work)
```

`direct/` rather than `nbody/`, because the shell code is also an N-body method. Both folders
are then named on the same axis: how the force is computed.

**`potentialEnergy` lives on the `ForceModel`, not in `diagnostics.ts`.** This is load-bearing.
The energy gate means something only if U is the exact potential whose gradient the integrator
stepped. For Plummer softening,

    Φ = −Gm/√(r²+ε²)     ∇Φ = Gm·r/(r²+ε²)^{3/2}

— consistent. Pairing softened forces with an unsoftened potential produces apparent energy
drift that is an artifact of the *diagnostic*, and it would look exactly like a broken
symplectic scheme. The two solvers have genuinely different U (pairwise sum against shell sum),
so co-locating each with its own force is what makes them un-mixable. This is the same species
as the ADR 0015 asinh bug: a dimensionally wrong softening constant that passed every
example-based assertion.

### Initial conditions, and a 2.3% units trap

The seats are already reserved in `core/cluster/params.ts`:

```ts
kinematics: { virialRatio: number };   // "Reserved for N-body; theory-only engines ignore it"
vx: number; // km/s — 0 until the dynamics engine draws velocities
```

So `ic.ts` is not new architecture. It takes a `ClusterIdentity`, calls `sampleCluster()` for
masses and positions, draws velocities on a `subStream(seed, "velocity")`, scales them to
`kinematics.virialRatio`, and fills `vx/vy/vz`. Two-clump initial conditions are two identities
with offset centres, which needs no new machinery.

**`LatentStar` velocities are km/s; the existing dynamics works in pc/Myr.** One km/s is
1.0227 pc/Myr — small enough to look plausible, large enough to invalidate every energy number.
Both that conversion and G are **derived in `core/constants`, never typed**:

```
MYR_S           = 3.15576e13                        // IAU Julian year 365.25 d, exact
KM_S_TO_PC_MYR  = 1e5 * MYR_S / PC_CM
G_PC3_MSUN_MYR2 = GM_SUN_CGS * MYR_S**2 / PC_CM**3
```

Verified in-session against the repo's own constants:

```
KM_S_TO_PC_MYR       1.022712165045695
G [pc³/M☉/Myr²]      0.004498502151469551
G [pc (km/s)²/M☉]    0.0043009172700362785
```

The third line falls out with nothing else typed in and lands on the value standardly quoted
for G in those units. **That value has not been cited to a source in this session**; before it
becomes a comment it needs a real citation checked. `G_kms = G / KM_S_TO_PC_MYR²` is an
identity, which is why both belong in one place: two independently typed constants can
disagree, two derived from one root cannot.

### Gates

Per ADR 0017, most of this is Vitest; only the fixture comparisons are a `check-*` gate.

**The two that carry the weight.**

*Time-reversibility.* Integrate n steps, negate all velocities, integrate n more, compare to the
start. Leapfrog is exactly time-reversible, so this returns to round-off. It needs no physics
reference and catches essentially any KDK bookkeeping error.

*Energy: slope, not maximum.* ADR 0016's claim is that energy does not drift over a long
lecture. The property is **bounded oscillation with no secular trend**, so the assertion is a
linear fit to E(t) requiring |slope × T| ≪ oscillation amplitude. A maximum-only test passes for
RK4 over a short run, which would make it decoration.

*Teeth-proof:* swap KDK for forward Euler, confirm the slope test fails, restore.

**Conservation, which doubles as a wiring check.**

| property | `direct` | `meanField` |
| --- | --- | --- |
| total **L** conserved | exact (central pairs, N3L) | exact (central about origin) |
| total **p** conserved | exact | **no** — the fixed origin is a preferred point |
| per-star **L** conserved | no | **exact** |

Swap the models and three assertions flip.

**Kepler**, `direct` only, at ε/a = 10⁻³. The softened force is not Kepler, so the expected
deficit is derived rather than fitted: (1+ε²/r²)^{−3/2} ≈ 1 − (3/2)(ε/a)² = 1.5 × 10⁻⁶. State
the property, set the bound above it, record the measured value in a comment.

**Cross-check.** On an equal-mass Plummer sphere the two force models must agree to the
discreteness noise.

**Corrected 2026-07-26 by measuring it.** This said the noise scales as 1/√N. It does not.
Measured median per-star radial disagreement: 0.1012 / 0.0710 / 0.0472 at N = 200 / 1000 /
4000 — a 20× increase in N shrinks it 2.15×, against 4.47× for N^(−1/2) and 2.71× for
**N^(−1/3)**. The difference is dominated by a star's NEAREST NEIGHBOUR, not by bin
statistics, which is the Holtsmark result. A bound set from the 1/√N argument would have been
wrong by more than a factor of two.

The consequence for the test is better than the original plan: the per-star assertion is
two-sided. It must be at least ~1%, because two models that agreed closely per star would mean
one of them was not doing what it claims; and it must shrink with N. The quantity that *does*
average out is the total potential energy, which agrees to under 1% (measured ratio 1.0085 at
N = 2000), and that is where the tight bound goes.

**Run it somewhere other than home.** All of this is pure node, no GPU — the integrator runs on
the CPU and the GPU only draws, so **no new parity case is needed**. The hero-fixture lesson
still applies directly: the characterisation fixture asserts to a stated relative tolerance,
**never bit-identity**.

### Order of work

`core/dynamics` has zero gates and zero callers today, so any move is unprotected and a "pure
move" that changed a number would be invisible.

1. **Commit a characterisation fixture first, on its own.** Run today's code at fixed
   seed and params; freeze `boundMassFraction`, `energy`, `rHalf` and `localSfe` at several
   times. This certifies current behaviour before anything moves.
2. **Build `types` / `integrate` / `ic` / `diagnostics` / `direct` / `meanField` fresh**, gated.
3. **Re-home the gas-expulsion code into `gasExpulsion/`**, consuming the shared integrator and
   `meanField/`, with the fixture proving nothing moved.

Step 3 is approved and in scope.

### Scale, stated rather than apologised for

Direct summation in plain TypeScript stays real-time to roughly N ≈ 2,000. That is honest for a
teaching instrument: plenty of real young clusters have a few hundred to a few thousand members,
and the page should say so. It also cuts the right way physically — direct summation with
softening produces *artificial* two-body relaxation on a timescale set by the N you can afford.
At N = 500 that is a feature, because you are modelling a 500-star cluster. At N = 10,000
standing in for 10⁶ stars it would be a lie, which is why the mean-field solver remains the
right tool at the N `gasExpulsion` runs.

---

## Part II — Extinction

### Port from fluxax, do not re-derive

`../jaxstro-dev/fluxax/src/fluxax/photometry/extinction/` already implements three verified
laws — `laws.py`, 301 lines — with every coefficient sourced from
`docs/plans/g23-equation-digest.md`, verified against the primary PDFs, with errata ERR-1 and
ERR-2 applied. Re-deriving them here would be slower and less trustworthy.

**Carry G23 and CCM89. Skip F99** (Anna, 2026-07-26): F99 needs a natural-cubic-spline port
from `jaxstro.numerics` for coverage G23 already provides.

- **G23** — Gordon et al. (2023), ApJ 950, 86. The default: piecewise UV/optical/IR assembly
  with smoothstep blends, covering all 30 of this repo's passbands.
- **CCM89** — Cardelli, Clayton & Mathis (1989), ApJ 345, 245. Closed-form, classic, and
  present so the lab can show two published laws **disagreeing**, which is an honest statement
  about model uncertainty.

Default R_V = 3.1, labelled as the Milky Way diffuse average (citation to verify).

### Three corrections recorded, because each was a wrong turn avoided

**1. The mid-IR gap closes; "grey out the two JWST bands" was wrong.** That recommendation
assumed CCM89 was the only law available. G23 models the mid-IR explicitly and covers both.

**2. The silicate remark is now sourced.** `_G23_IR_SIL` carries a modified-Drude feature at
λ₀ = 9.8434 µm, γ₀ = 2.21205 µm. JWST F770W at 7.663 µm does sit on its blue wing. This began
as recall and is now traced to code whose coefficients trace to the digest.

**3. A verbatim port would introduce a novascope-specific bug.** fluxax's CCM89 is
`np.where(x <= 1.1, a_ir, a_opt)` — everything above 1.1 gets the optical polynomial, with no UV
branch. That is correct *in fluxax*, whose own comment records that its bands stop at
x ≤ 3.33. This repo has HST_F275W at x = 3.693. Measured:

```
CCM89 optical/NIR polynomial, stated valid 1.1 <= x <= 3.3
V (552nm)          x= 1.810   A/A_V =  0.9937
valid edge         x= 3.300   A/A_V =  1.8021
LSST_u (372nm)     x= 2.686   A/A_V =  1.5401
HST_F275W (271nm)  x= 3.693   A/A_V =  0.9784   <- outside
extrap x=4.0                  A/A_V = -5.2060   <- dust brightens the star
```

The F275W value is the dangerous one: 0.978 looks entirely reasonable. Extinction rises steeply
into the near-UV, so it must exceed the 1.80 at the valid edge; instead the polynomial turns
over and reports the near-UV as no more extinguished than V. Nothing errors and the image
quietly stops being true. This is the audit addendum's lesson — *a claim verified only in the
environment where it was written* — arriving through a port rather than a rewrite. The bug is in
neither file; it is in the assumption that travelled.

**The digest carries CCM89 rows 1–3 only** (master relation, IR 0.3 ≤ x ≤ 1.1, optical/NIR
1.1 ≤ x ≤ 3.3). There is no verified UV branch, and inventing one is what site-claims forbids.
So **CCM89 declines x > 3.3 through an explicit domain flag; G23, the default, covers
everything.** The validity-flag mechanism survives from the first draft of this design; the
reasoning behind it was replaced.

### The seam, and why novascope gets the honest treatment free

`spectralFluxCgs` is already the per-wavelength integrand inside `bandIntegral`. Extinction
multiplies it by 10^(−0.4·A(λ)), so the spectrum reddens **before** the filter integrates —
the only correct order. Applying A at λ_eff to an already-integrated flux produces a plausible
number that is wrong in a way invisible in the output.

```ts
bandFluxDensityCgs(teffK, radiusRsun, distancePc, band, attenuation?)
```

Optional, defaulting to none, which is what makes the A_V = 0 no-op gate below possible.

fluxax's `ExtinctionModel` names a distinction worth importing along with the equations:

- `treatment="constant"` — A_x/A_V evaluated once at a 5000 K reference SED, then linear in A₀.
- `treatment="teff"` — the honest, source-temperature-dependent band extinction, via a
  precomputed trilinear grid.

fluxax needs the grid because it must be **differentiable**. novascope does not. Multiplying the
existing per-star integrand by the attenuation gives the Teff-aware answer directly, with no
grid and no interpolation. That is ADR 0016 in its purest form: implement the method, do not
load the export.

### Gates

**Lead with cross-implementation parity against fluxax.** Its constant-treatment formula is a
closed-form target:

    A_x/A_V = ∫ B_λ(5000K) T_x(λ) [A/A_V](λ) dλ / ∫ B_λ(5000K) T_x(λ) dλ

Generate those coefficients from fluxax, commit them as a fixture, and require novascope's
per-star integration to reproduce them at 5000 K. Cross-language and cross-implementation — the
same species as `check-lupton` (astropy) and `check-imf` (progenax), and it tests the ported
coefficients directly.

**A published bound that did not have to be invented.** The digest records *G23 against CCM89 at
R_V = 3.1: average fractional deviation 0.03, maximum 0.18* (G23 p.11 Fig 8). The two-law spread
is therefore assertable against a paper. Set the bound with headroom above 0.03 and 0.18 and
record the measured values in a comment.

**The rest, as Vitest:**

| property | why it has teeth |
| --- | --- |
| A_V = 0 is exactly a no-op | protects every shipped page; the optional parameter must be provably inert |
| a(0) + b(0)/R_V = 1 at y = 0 | CCM89's own normalisation, exact for any R_V |
| the repo's V gives 0.9937, not 1 | λ_eff 552.4 nm ≠ CCM89's 1.82 µm⁻¹ — a convention offset, **recorded, never fitted away** |
| every band dims; B−V rises with A_V | no band may brighten |
| A_x differs between a hot and a cool star | proves the Teff-aware version is running, not the fixed-SED one |
| CCM89 declines x > 3.3; G23 accepts | the domain flag is real |

**A tripwire nobody can predict from the armchair.** `check:star-optics` asserts Spearman
ρ = 1.00000 across all bands, and the roadmap calls it *"a deliberate tripwire — the day it
fails is the day the model stops being a ZAMS toy."* Because A_x depends on Teff and Teff varies
per star, **even a uniform A_V may reorder stars between bands.** Whether it does at realistic
A_V is a measurement, not a deduction. If it fires, that is the gate working: update it
deliberately with the measurement recorded, never quietly relax it.

### Scope boundaries, both explicit

1. **`teffToRGB` is not swapped site-wide.** The lab uses `blackbodyLinearRGB` with the
   attenuation inside the CIE integral, which is the trigger the audit named — a Teff→RGB fit
   cannot express a reddened star, because no temperature means "20000 K behind dust." But
   changing `star().color` touches every canvas page for a measured 7/255 difference. Separate
   decision, separate session.
2. **A_V is one uniform scalar in v1.** fluxax's `UniformDust` / `SkyGradientDust` /
   `AnchoredDust3D` is the spatial axis; v1 designs for it and does not build it. The 3-D dust
   cube and the spatial R_V field stay in fluxax.

   **The named next step, immediately after extinction works (Anna, 2026-07-26): the gravoturb
   gas data.** That is the physically honest route to a spatial A_V — the gas density field *is*
   the dust column, so A_V per star becomes a line-of-sight integral through a realization rather
   than a slider. It is also the point at which ADR 0014 applies: a gravoturb hydrodynamics
   realization is a *realization*, labelled as one, not physics novascope owns. The v1 seam is
   built for it — `attenuation` is per star, not one global factor — so this composes rather than
   forcing a rewrite. It is what makes the Spearman tripwire below near-certain to fire, since
   differential extinction is exactly what `check:star-optics` names as the condition that ends
   the ZAMS toy.

**A_V is labelled on the page as a free parameter of the lab, not a measurement.**

### Licence

fluxax is Apache 2.0. This repo carries no `LICENSE` and no `license` field in `package.json`.
Anna's intent is Apache 2.0, **to be settled when novascope is extracted** — not now. Ported
files carry a provenance header naming fluxax, the digest and the primary papers regardless,
which is this repo's normal practice and is what Apache 2.0 will want later.

---

## Open, and not decided here

- **The CCM89 UV branch** (Eqs 4a/4b, 3.3 ≤ x ≤ 8) is unverified and unported. Sourcing it means
  reading the primary PDF and adding a digest row. Until then CCM89 declines HST_F275W.
- **`docs/plans/g23-equation-digest.md` has not been read** (367 lines). It is the coefficient
  source of truth and must be read before the port, not after.
- **CCM89's stated validity limits** (0.3 ≤ x ≤ 10 overall) came from memory in this session and
  are corroborated only by fluxax's own docstrings. Verify against the paper.
- **G in pc (km/s)²/M☉** matches a remembered standard value to seven figures. Needs a citation
  before it becomes a comment.
- **Whether the Spearman tripwire fires** under uniform A_V. Measure; do not predict.
- **`src/lib/gravoturb.ts` moving into novascope** (Anna intends this later). It imports
  `node:fs` and `node:path`, so it cannot enter `core/` without breaking the boundary gate. It
  would need a higher-layer seam. Out of scope here.

## What this session verified, and how

Five commands, all recorded above:

1. `G` and `KM_S_TO_PC_MYR` derived from `core/constants` — values in Part I.
2. All 30 passband λ_eff measured against CCM89's stated range — two outside (JWST F444W at
   x = 0.226, F770W at x = 0.130).
3. The CCM89 optical polynomial evaluated inside and outside its range — the table in Part II.
4. fluxax's extinction module read: `laws.py`, `model.py`, `__init__.py`, and the digest's
   CCM89 section index.
5. `core/dynamics/index.ts` read in full, twice.

Everything else in this document is design, and no part of it has been implemented.
