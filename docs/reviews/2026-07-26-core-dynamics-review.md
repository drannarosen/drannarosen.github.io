# core/dynamics quality review — 2026-07-26

Scope: commits `9ef650f`..`fbb5850` (tasks 1–6 of
`docs/plans/2026-07-26-dynamics-and-extinction-labs-design.md`), plus the modules they touch.

Method follows the 2026-07-26 extraction audit: every claim is labelled **(read)** — opened in
this session — or **(measured)** — produced by a command whose output is recorded here.

Commands run to completion:

```
pnpm test        77 passed, 12 files
pnpm check       0 errors, 0 warnings, 6 hints (all pre-existing three.js deprecations)
pnpm build       green, 35.9 s
check:dynamics   69 quantities, exact
```

---

## Grades

| Axis | Grade | One-line reason |
| --- | --- | --- |
| **Physics correctness** | **A** | Every claim is gated against something external — Kepler, an analytic oscillator, a frozen fixture, progenax's G. Three of my own arithmetic errors were caught by measurement rather than shipped. |
| **Test quality** | **A** | Contract tests with proven teeth (170,000× and 2.1e53 margins), bounds derived rather than fitted, and a two-sided assertion that the models must DIFFER. |
| **Architecture** | **A−** | The ForceModel seam is right and `potentialEnergy` is correctly placed. Two misplacements and one TDZ landmine. |
| **DRY / one home per fact** | **B** | Four kinetic-energy implementations and four duplicated grid constants. Both are exactly the species this repo's discipline exists to prevent, and I introduced them. |
| **Performance** | **B−** | `diagnostics()` costs 4.1× a physics sub-step, for a readout. |

**Headline: the physics and the testing are strong; the plumbing has four DRY defects I
introduced and should not have.** None is a correctness bug today. All four are the shape that
becomes one later.

---

## P1 — DRY violations, all introduced by this work

### 1a. Kinetic energy is implemented four times (measured)

```
src/novascope/core/dynamics/integrate.ts:109        kinetic += 0.5 * mass[i] * (vx*vx + vy*vy + vz*vz)
src/novascope/core/dynamics/ic.ts:127               t += 0.5 * state.mass[i] * (vx*vx + vy*vy + vz*vz)
src/novascope/core/dynamics/gasExpulsion/index.ts:266   kinetic += 0.5 * state.mass[i] * (...)
src/novascope/core/dynamics/gasExpulsion/index.ts:348   kinetic += 0.5 * state.mass[i] * v2
```

`ic.ts` exports `kineticEnergy(state)`. The other three do not call it.

**Why it matters beyond tidiness:** the virial ratio, the energy readout and the scaling target
are all built on T. Four copies is four places a factor of 1/2 or a missing mass can diverge,
and every one of them would still *conserve* — so the integrator tests would stay green while
the reported physics was wrong by a constant. That is precisely the failure mode
`potentialEnergy`-on-the-ForceModel was designed to prevent for U, and I did not apply the same
reasoning to T.

**Fix:** one `kineticEnergy(state)`, in `diagnostics.ts`, called by all three.

### 1b. The radial grid and softening are declared twice, with identical values (read)

| home | values |
| --- | --- |
| `meanField/index.ts:96–99` | `softening ?? 0.02`, `nBins ?? 320`, `rMin ?? 0.01`, `rMax ?? 200` |
| `gasExpulsion/index.ts:69–72` | `SOFTENING = 0.02`, `NBINS = 320`, `R_MIN = 0.01`, `R_MAX = 200.0` |

The comment in `gasExpulsion` claims this is deliberate — "THIS model's calibration, not the
force module's opinion." **That argument does not survive the values being identical.** If
someone tunes `meanField`'s default grid, `gasExpulsion` silently keeps its own and the two
quietly disagree about what the default is, with no gate able to see it. ADR 0015 records the
same shape in `core/feedback` as an accepted debt; there is no reason to create a fresh
instance of it.

**Fix:** `meanField` exports `MEAN_FIELD_DEFAULTS`; `gasExpulsion` imports it and states only
what it genuinely overrides. Better still, drop the grid defaults entirely — a radial grid is a
physics choice, and `direct/` already refuses to default its softening for exactly that reason.
The inconsistency between the two modules is itself a finding.

### 1c. `diagnostics.ts` imports from `ic.ts` — the dependency runs backwards (read)

`kineticEnergy` lives in `ic.ts` (initial conditions) and `diagnostics.ts` imports it. Kinetic
energy is not an initial-conditions concern. Fixing 1a fixes this: the function moves to
`diagnostics.ts` and `ic.ts` imports it instead, which is the direction that reads correctly.

---

## P2 — performance and structure

### 2a. `diagnostics()` rebuilds the radial profile three times (measured)

```
gasExpulsion/index.ts:338   force.potentials(...)        -> buildProfile
gasExpulsion/index.ts:376   measureQ() -> refreshProfile -> buildProfile
gasExpulsion/index.ts:381   force.potentialEnergy(...)   -> buildProfile
```

Measured at n = 10,301: **`diagnostics()` = 3.44 ms; one physics sub-step = 0.85 ms.** The
readout costs **4.1×** the physics it reports on, and 20% of a 60 fps frame budget.

Three rebuilds plus a sort in `lagrangianRadii` plus per-call allocation of `phi` and the index
array. `refreshProfile` was added precisely so profile state would not depend on call ordering,
and the honest consequence is that every entry point now rebuilds defensively.

**Fix:** rebuild once at the top of `diagnostics()` and give `MeanFieldForce` a way to say
"already current for these positions" — a generation counter, not a boolean, so a stale flag
cannot silently pass.

### 2b. `momentum()` and `angularMomentum()` are on the wrong object (read + measured)

They sit on `Leapfrog`, and their only consumers are four lines in `direct.test.ts` (measured).
They are properties of the **state**, not of the integrator — a state has a momentum whether or
not anything is stepping it. `diagnostics.ts` is their home.

### 2c. A TDZ landmine in `gasExpulsion` (read, `index.ts:202–215`)

```ts
const force: MeanFieldForce = createMeanFieldForce(n, {
  external: {
    enclosedMass: (r, t) => gasMassAt(t) * fEncBin[force.binOf(r)],  // force, fEncBin
    potential:    (r, t) => gasMassAt(t) * phiGasUnit[force.binOf(r)],
  },
});
const fEncBin = new Float64Array(NBINS);      // declared AFTER
const phiGasUnit = new Float64Array(NBINS);
```

The closures reference `force`, `fEncBin` and `phiGasUnit` before any of the three exists. It
works **only** because `createMeanFieldForce` never invokes `external` during construction. The
day it does — to precompute a table, say — this throws `ReferenceError` at construction, and
the message will point at the wrong file. Not a bug today; a trap with no warning sign.

**Fix:** build `fEncBin`/`phiGasUnit` before the force, and pass a small object that closes over
its own `binOf` derived from the same grid parameters.

### 2d. Dead initialization with a dangerous value (read, `index.ts:238`)

```ts
let leap: Leapfrog = createLeapfrog(state, force, { maxStep: Infinity });
```

Allocates a full `Float64Array(n*3)`, is unconditionally replaced by `reset()` at the end of the
factory, and exists only to satisfy definite assignment. `maxStep: Infinity` also means "take
one step of whatever dt you are given" — catastrophic if it were ever reached. A value that is
both dead and dangerous should not be written down.

---

## P3 — coverage gaps, named so they are not mistaken for coverage

| gap | note |
| --- | --- |
| `gasExpulsion` has no unit test | Only `check:dynamics`, which costs 7.8 s. Cheap properties go untested: `beginExpulsion()` refusing before settle, `setParams` implying reset, `survivingFraction === 1` with no expulsion (the control the module header claims). |
| No test drives both force models through one integrator | The whole point of the `ForceModel` seam, and nothing asserts they are actually interchangeable. |
| Five exports have no production consumer (measured) | `softeningForCluster`, `combineStates`, `toLatent`, `createDirectForce`, `clusterState`. Task 9 consumes all five, so this is "built one task ahead" rather than dead — but it is the pattern the extraction audit flagged, and if task 9 slips it becomes real. |
| `createDynamics` still has no page consumer | Unchanged from the extraction audit; it is now gated, which it was not before. |

---

## What is genuinely good, and should be kept when the above is fixed

Stated so a later pass does not undo it.

- **The fixture-first discipline demonstrably worked.** The re-home reproduced 69 quantities to
  1.45e-14. Had the baseline been captured alongside the change, it would have proved nothing.
- **The gradient contract test.** Numerically differentiating `potentialEnergy` and comparing to
  `accelerations` is the single most valuable test in the tree, and it was proven to fail by
  170,000× when the softening was desynchronised.
- **Bounds derived, not fitted.** Every tolerance cites the property it comes from and records
  the measurement separately. The tropical-year gate is the clearest case: the bound sits
  between the honest 5.0e-6 residual and the 3.8e-5 a wrong year produces.
- **The two-sided model-difference assertion.** `direct` and `meanField` must differ by at least
  ~1% per star, because two models agreeing closely would mean one was not doing what it claims.
  Asserting a *lower* bound on a discrepancy is unusual and it is the correct physics.
- **Measurement caught three of my own errors** before they shipped: the energy amplitude (10×
  off), the Kepler headroom (13× off, plus an assertion that could not see what it claimed), and
  the cross-check scaling (N^(−1/3), not N^(−1/2)).

---

## Backlog

| # | item | effort |
| --- | --- | --- |
| 1 | One `kineticEnergy`, in `diagnostics.ts`, called by all four sites | 20 min |
| 2 | Export `MEAN_FIELD_DEFAULTS`; stop restating the grid in `gasExpulsion` | 20 min |
| 3 | Rebuild the profile once per `diagnostics()`, guarded by a generation counter | 45 min |
| 4 | Move `momentum`/`angularMomentum` from `Leapfrog` to `diagnostics.ts` | 20 min |
| 5 | Fix the TDZ ordering and delete the `maxStep: Infinity` initializer | 20 min |
| 6 | `gasExpulsion.test.ts` — the cheap properties the 7.8 s gate does not reach | 45 min |
| 7 | One test driving both force models through the same integrator | 20 min |
