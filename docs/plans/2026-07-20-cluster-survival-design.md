# "Does the cluster survive?" — design and findings

Date: 2026-07-20 · Status: **built, then unpublished. Blocked on gravax.**

## Why this document exists

A working version of this explorable was built, validated, published, and then
reverted the same session. It was reverted for two independent reasons — an
accessibility hazard and an architectural decision to build it on gravax instead
— and a lot of physics was measured along the way. This record exists so none of
that measurement is repeated.

The code is still in the repo and ships nowhere (verified: no `dist/` output
contains the solver). Nothing needs to be rebuilt from scratch.

## The piece

A young cluster is born inside far more gas than it turns into stars. When its
massive stars blow that gas away the cluster loses most of the mass binding it,
and the textbook calculation says a cluster below ~30% star-formation efficiency
should disperse entirely. Since observed efficiencies are far below that, this
would mean nearly every cluster dies in infancy.

The reader sets two physical knobs — star-formation efficiency **ε** and
expulsion timescale **τ/t_cross** — and watches the real stars decide.

**The payoff, which is better than the classic story it sets up.** The cluster
survives efficiencies the textbook calls fatal, and the reason is visible before
anything is expelled: the efficiency *inside the cluster* is far above the
global value, because λ_corr couples star formation to local density and the
stars end up sitting where nearly all the gas already became stars. The diffuse
majority that drags the global number down was never binding the cluster.

Measured from the exported model, at the settled half-mass radius:

| global ε | local ε |
| --- | --- |
| 0.05 | 0.42 |
| 0.10 | 0.45 |
| 0.20 | 0.78 |
| 0.30 | 0.87 |
| 0.50 | 0.98 |

This is the modern resolution of the infant-mortality problem, and it falls out
of the model rather than being asserted. It is the reason the piece is worth
finishing.

## Why it is blocked

The gas expulsion is a **time-dependent external potential**. gravax cannot
express one today. Three specific gaps, all verified by reading the source:

1. **`SystemParams.ext_potential` is stored but never read by any force path.**
   Its own docstring says "External potentials (future)". Only three call sites
   reference it, all guards. `integrators/hierarchy/direct_map.py:81` and
   `integrators/ppmsm/checkpoint.py:302` refuse loudly when it is set; **every
   other integrator silently ignores it.** That silent ignore is a wrong-physics
   trap worth closing in gravax independently of this website.
2. **`ExternalPotential.potential(r)` takes no time argument**
   (`physics/protocols.py:42`). A draining gas cloud is inherently
   time-dependent, so the protocol cannot express it even once it is wired in.
3. **No truncated-EFF potential** exists in the family — `physics/potentials/`
   provides Plummer, Hernquist, NFW, Miyamoto-Nagai, PowerLaw, MilkyWay.

### What gravax would need

- Wire `ext_potential` into the acceleration path (touches every integrator).
- Extend the protocol to `potential(r, t)`, or admit a separate time-dependent
  potential type, so the gas mass can decay.
- A truncated-EFF or tabulated-profile potential. The tabulated route is already
  proven: `scripts/gravoturb/export_cluster.py` writes `gas_menc.f32`, the
  cloud's own `M_gas(<r)/M_gas` integrated from `EFFProfile.density`.

### What gravax already provides and should be used

- `build_eff_system` — EFF cluster ICs, matching the site's cloud.
- Validated integrators: Leapfrog, Yoshida4, PEFRL, FSI4/6, Hermite, IAS15.
- `evolve_chunked_generic` — chunked evolution, i.e. trajectory snapshots.
- `half_mass_radius`, `lagrangian_radii`, `crossing_time`, `velocity_dispersion`,
  `energy_error`, `relaxation_time` — every diagnostic the prototype hand-rolled.

A real N-body run also dissolves most of the prototype's limitations at once: no
spherical approximation, genuine two-body relaxation, no mean-field energy
pathology.

## Accessibility — the hazard that must not recur

**This is the most important thing in this document.**

The published version animated 30 crossing times of violent relaxation in 1.8
seconds. Because it stepped `dt = t_cross/8` per frame at 60 fps, it ran **7.5
crossing times per second**, and the cluster's collapse-and-bounce oscillates on
roughly a crossing time.

Measured, using stars projected inside 0.1 pc as a central-surface-brightness
proxy:

| phase | pulse rate | largest single-frame jump |
| --- | --- | --- |
| **settling** | ~12 Hz | **73% of peak** |
| expulsion | ~12 Hz | 5% |
| expulsion, 5× slower | ~12 Hz | 2% |

In three consecutive frames the core went 72 → 1377 → 5098 stars. WCAG 2.3.1
allows 3 flashes per second. This was a genuine photosensitive-seizure hazard on
a large bright area against a dark background, and it shipped.

**Constraints for any rebuild:**

- **Never animate the settling/relaxation phase.** It is numerical preparation,
  not the phenomenon. Precompute it, or reveal the settled state directly.
- The expulsion phase itself measures safe and can be animated.
- **Honor `prefers-reduced-motion` in the simulation loop**, not only in the
  renderer. The prototype's `requestAnimationFrame` tick called
  `setStarPositions` regardless, forcing a redraw every frame and delivering the
  full strobe to reduced-motion users.
- Sample real rendered frames to confirm, rather than trusting a star-count
  proxy. That measurement was never done.

## Physics findings — do not rediscover these

### The exported IC is 60× sub-virial

`Q = T/|W| = 0.0084`. σ₃D = 0.665 pc/Myr where virial equilibrium needs 5.14.

The cause is upstream and worth a decision in progenax: `VelocitySpec(mode=
"physical")` normalizes the velocity grid so its rms is σ_g = ℳ·c_s — a cloud
turbulence prescription carrying no knowledge of the cloud's binding energy. A
19,400 M☉ cloud inside 2.5 pc needs ~5 km/s of support and has 0.65.

This affects no existing page — nothing else integrates these velocities — but
as a dynamical object the IC is a collapsing cloud, not a cluster. The
`virial_target` mode that would fix it refuses a gas component.

### A mean-field spherical solver cannot integrate that collapse

Total-energy drift over 10 crossing times, integrating the raw IC, versus
sub-steps per crossing time:

| sub-steps | 100 | 200 | 400 | 800 | 1600 | 3200 |
| --- | --- | --- | --- | --- | --- | --- |
| drift | 0.89 | 1.28 | 0.61 | 0.55 | 0.60 | 0.60 |

**It does not converge.** This is structural: a mean-field solver does spurious
work when the potential changes violently between force evaluations. Refining
the timestep cannot fix it. If the collapse phase itself is ever wanted, it
needs a real N-body.

Virial-scaling to Q = 0.5 first drops the drift to **2×10⁻⁴** — a factor of
3000 — and the same convergence sweep then shows a clean plateau from 200 to 800
sub-steps.

### Even virialized, the IC is not an equilibrium configuration

The turbulent star positions carry gravoturbulent substructure and their
velocity distribution is not the matching equilibrium DF. With **no gas
expulsion at all**, the system rearranges and sheds 6–30% of its mass while r_h
collapses by up to 5×. Left uncorrected this masquerades as expulsion unbinding
the cluster — and did, in the first results table, which was non-monotonic and
backwards.

Fix: settle for 30 crossing times before expelling, and report survival relative
to the settled cluster. Verified stationary — bound mass fraction is *identical*
at 30 and 60 crossing times (0.938/0.938, 0.911/0.911, 0.786/0.786 at ε =
0.05/0.20/0.50) even though r_h still oscillates.

### Virial term ≠ potential energy

The subtlest bug, and the one that produced a table where **higher** SFE gave
**lower** survival.

For a system in an external potential the equilibrium condition is
2T = Σmᵢ rᵢ·∇Φ, not 2T = |U|. The virial term counts only mass *interior* to
each star; the potential energy also counts mass *exterior*, which contributes
to Φ but exerts no net force. The two are nearly equal for an isolated cluster
and wildly different inside an extended gas cloud, so using the energy
over-heated the scaled cluster by an SFE-dependent factor.

Both quantities are needed, for different jobs:

- **Virial term W = −Σmᵢ G M_enc(<rᵢ)/rᵢ** → the Q = 0.5 scaling.
- **Potential energy U = ½Σmᵢ Φ★ + Σmᵢ Φ_gas** → boundness. Escape is set by Φ.
  Note the external gas term takes **no ½ factor**; that factor is only for
  stellar self-interaction. Applying it to the gas was a separate bug.

### Determinism

Freezing the reported numbers at the moment the cluster *settles*, rather than
when the reader presses expel, is required: r_h keeps oscillating after the
bound population has stopped changing, so sampling at press time made local ε
move ~6% with reaction speed and the survival fraction move up to 8%. The
prototype also paused integration once settled, so runs are reproducible.

### Validation achieved

| test | result |
| --- | --- |
| no-expulsion control | exactly 1.000 across all SFE |
| energy drift, 10 t_cross | 2×10⁻⁴ |
| timestep convergence | plateau, 200–800 sub-steps |
| settled-state stationarity | bound fraction identical at 30 and 60 t_cross |
| browser vs offline solver | 87% / 0.78, exact agreement |

### The gas never visually left — log colorbars hide mass loss

Reported by Anna on the built version and confirmed by computing the shader math
against the real `meta.json`. **This is the finding most likely to be
rediscovered painfully, because the readout and the picture disagreed.**

The volume shader maps density through a 6-dex log colorbar, so removing a
factor of 10 in gas mass moves the image by only 1/6 of its dynamic range:

| gas remaining | core brightness |
| --- | --- |
| 100% | 1.00 |
| 10% | 0.77 |
| 1% | 0.55 |
| **0.4%, which the readout rounds to "0%"** | **0.46** |
| 0.01% (the `uGasFrac` clamp floor) | 0.13 |

The page announced "gas left 0%" while the cloud core still rendered at 46% of
full brightness.

The *old* homologous page dimmed even less — its core only reaches 0.59 — but it
also expanded the cloud by S = 4.5, spreading it over **91x the volume**, so the
surface brightness per pixel collapsed and it visibly dispersed. **The geometric
expansion was doing all the work of reading as "cleared", not the dilution.**
Replacing it with fixed-shape mass decay removed the only legible mechanism.

**Do not fix this with a display hack** (fading the volume alpha by gas
fraction). The real lesson is physical: gas expulsion is an **outflow**. The gas
is driven out; it does not evaporate in place. Removing mass uniformly at all
radii is only valid if the removed mass teleports to infinity. Real feedback
clears **inside-out** — gas near the massive stars goes first and a shell sweeps
outward, so M_gas(<r) drops at small radii before large ones. That is a
different, and more interesting, potential history, because the cluster sits
exactly where the gas leaves first.

**This converges with the gravax requirement.** What is needed is a
time-dependent radial *profile* — an evacuating cavity — not a time-dependent
scalar mass multiplying a fixed profile. One feature delivers both correct
physics and a legible picture. Specify the gravax external-potential work in
those terms.

### Latent bug in the currently-published page

`engine.ts:231` computes `autoExpel && !reduceMotion`, so with
`prefers-reduced-motion: reduce` the auto-expulsion loop is disabled entirely
and `expel` stays pinned at 0. On the published `/explore/gas-expulsion`, a
reduced-motion reader sees a static embedded cloud forever, with a "play the
loop" checkbox that does nothing, on a page whose entire subject is expulsion.
The slider still works if they find it. Not yet fixed.

### Known weaknesses never fixed

1. **Boundness is not iterated.** Standard practice removes unbound stars,
   recomputes Φ, and repeats. One pass leaves escapers contributing to the
   potential, biasing the bound fraction high.
2. **The binned force is a step function in r**, so it is not formally the
   gradient of the Φ used for boundness. Empirically consistent, not symplectic.
3. **Q is inflated by escapers**, which keep kinetic energy at large radius
   where they contribute little to W.
4. **The settled cluster is a relaxed descendant of the IC, not the IC** —
   r_h goes 0.68 → 0.36 pc. What was tested had been substantially reprocessed.
5. Gas is removed at fixed shape, uniform in radius. Real feedback clears
   inside-out and anisotropically.
6. `localSfe` uses r_h quantized to bin edges, ~3% radial resolution.

A real gravax N-body removes 1–4 outright.

## What already exists in this repo

- `scripts/gravoturb/export_cluster.py` — writes `velocities.f32` (pc/Myr, COM
  pinned) and `gas_menc.f32` (the cloud's own enclosed-mass profile), plus G,
  M★, r_h, σ₃D, t_cross and the measured virial ratio in `meta.json`.
- `src/lib/cluster/dynamics.ts` — the validated mean-field solver, with every
  measurement above recorded in its header and constants. Useful as a
  cross-check target even if gravax replaces it.
- `engine.setStarPositions()` — per-frame position updates without touching the
  palette.
- `engine.setGasFraction()` and the `uGasFrac` uniform — dims the cloud at
  **fixed radial shape**, which is what the integrator assumes. The pre-existing
  `uExpel` homologous mode is a different thing the dynamics does not model;
  using it here would reintroduce exactly the render-trick problem this rebuild
  set out to remove. Inert at its default of 1.0.

## Open questions

- **Live solve or precomputed trajectory?** Precomputing removes the flash
  hazard at the root and costs no browser CPU, but 10,000 stars × 3 × int16 is
  60 KB/frame — ~9 MB per run at 150 frames, ~2.7 MB at 3,000 stars — and one
  run is needed per ε, which kills the continuous slider. The continuous slider
  is much of the piece's value. Unresolved.
- Should progenax offer a virial-consistent velocity normalization with gas
  present? Currently `virial_target` refuses a gas component.
- Does startrax belong here? It owns winds, remnants, and explodability, so it
  could ground **τ** physically — when the massive stars actually inject their
  energy — rather than leaving it a free knob.
