# Time-symmetric dynamics, and the scenario model for /dynamics-lab

Agreed with Anna 2026-08-04. Phase 1 (the integrator) is built; phases 2–3 are not.

## Why

`/dynamics-lab` measured its own Hermite getting **worse the harder it worked** — 5.7e-4 at
9809 force evaluations per crossing time against 1.3e-5 at 1928. That is a secular error, and
its cause is not the corrector but the step rule: `dt = h(xi_0)` depends on one endpoint, so the
map is not invariant under time reversal.

Softening was the page's only lever against it, which is why the page had a softening slider at
all. Measurement showed the slider was scaffolding rather than physics: adaptive Hermite at
**exactly zero softening** conserves to 3.4e-5, better than any softened rung on the page.

## Decisions

**1. The fix is a time-symmetric step rule, not block timesteps.** The first proposal here was
individual/block timesteps to cut cost. gravax rejects that for correctness: *"Per-particle
block steps break symmetry (Kokubo/Hut)."* Block steps would have reduced cost without touching
the secular error. Ported instead: Kokubo (1998) P(EC)^n corrector plus the Hut, Makino &
McMillan (1995) shared step `dt = 1/2 [h(xi_0) + h(xi_1)]`.

**2. `hermite.ts` stays, unchanged, as the control.** An asymmetric scheme beside a symmetric one
is what makes "the symmetry of the step rule is what conserves the energy" a measurement rather
than an assertion — the role the leapfrog already plays for FSI4. FSI4 remains the default.

**3. The criterion must be a pure state function.** `h(xi) = eta |a| / |j|` from directly
evaluated derivatives. gravax records that building `h` from interpolated derivatives — which is
exactly what `hermite.ts`'s `advised()` does — made the symmetric scheme drift **more** than the
asymmetric baseline. Reusing that function would have looked like sensible code reuse.

**4. eta = 0.1, measured here, not gravax's 0.01.** Their value parameterises the full Aarseth
criterion (snap and crackle); this is the cheaper curvature-blind form. Cost goes as 1/eta,
error as ~eta^4. The scan is in the module header.

**5. Softening becomes a policy that cannot see the state.** Per-particle `eps_i`, combined as
`sqrt(eps_i eps_j)`, as gravax's `ConstantSoftening` does. State-dependent softening (soften only
close pairs) is NOT offered: it makes the acceleration stop being the gradient of the potential
without a grad-eps correction term, which is the trap `types.ts` already warns about. Making the
policy structurally unable to see positions is the same move `stepsForSoftening` made for the
eps/dt confound. *(Not yet built — phase 2.)*

## The cost constraint, which shapes the UI

Measured, N = 200, 10 crossing times, adaptive, zero softening:

| scheme | worst dE/E | evals / t_cross | wall |
| --- | --- | --- | --- |
| symmetric | 4.77e-10 | 147806 | 222 s |
| asymmetric | 3.40e-5 | 3758 | 7 s |

One symmetric step costs 8 force evaluations against 1. At eta = 0.1 the cost falls to ~12000
per crossing time, still ~6x. **So symmetric is the right scheme for few-body scenarios and
wrong as a cluster default** — at N = 2–10 the cost is irrelevant and the demonstration is exact.

The property itself, two-body fixture at 128 steps/orbit, peak dE/E:

| orbits | symmetric | asymmetric |
| --- | --- | --- |
| 4 | 2.38e-5 | 2.28e-4 |
| 64 | 2.43e-5 | 2.96e-3 |
| 256 | 2.56e-5 | 1.16e-2 |

Flat against a factor of 51. This table is the page's argument.

## Where things live

Everything in `core/dynamics/` (layer 0, pure, DOM-free). `/dynamics-lab` is one consumer, not
the owner — ADR 0010 and the boundary gate already require this.

## Remaining

- **Phase 2** — `SofteningPolicy` (per-particle), `scenarios.ts` (twoBody, cluster,
  binaryInCluster; each carries its own limits and which schemes are honest for it).
- **Phase 3** — the page: scenario selector, and an energy-vs-time strip chart. `monitor.history`
  already retains 600 samples and nothing plots it; the secular-vs-bounded contrast is a *shape*,
  and a single number cannot show it.
- **Deferred** — hierarchical triple; reversible-adaptive FSI4; SDAR/KS regularization.
- **Track B** (extinction: F99 from fluxax, A_V from a gas column) — a separate session.
