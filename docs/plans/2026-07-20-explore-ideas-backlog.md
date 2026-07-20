# /explore — next pieces, specced not built

Date: 2026-07-20 · Status: **approved in brainstorm, deferred**

Three ideas from the 2026-07-20 session. None started. The fourth piece from
that session — the cluster-survival rebuild — has its own record in
`2026-07-20-cluster-survival-design.md` and is blocked on gravax.

## The diagnosis these all come from

`/explore/cluster` works and the other two do not, and the reason is not polish.

The cluster page has a **question with a payoff** and a natural affordance
(scroll = time). Six beats, each changing the picture meaningfully, no UI to
learn.

The other two are **knob-first, not question-first**. They hand the reader a
slider with no reason to move it, no truth to check against, and no consequence.
The pattern that separates them: `/explore/cluster` answers *what happens next?*
while the others answer *what does this number do?* Explorables die when the
knob is an input to the model rather than something the world could push back
on.

Both fixes below convert a **setting** into a **measurement**.

---

## 1. `/explore/mass-segregation` → live Λ_MSR

**The problem.** The page exposes λ_corr, which is what `progenax` *inputs*. No
astronomer measures λ_corr; they measure Λ_MSR off an image. So the page shows
the cause and never the effect. Worse, between λ = 0 and 0.3 the visual barely
changes, which makes the slider feel broken rather than subtle.

**The rebuild.** Cluster on the left, a live **Λ_MSR(N_MST) curve** on the right
— the real Allison et al. (2009) minimum-spanning-tree estimator:

- Build the MST over the N most massive stars; take its total edge length.
- Build MSTs over ~50 random N-star draws; take the mean and the spread.
- Λ_MSR = ⟨random⟩ / massive, with the spread as the error band.
- Λ_MSR > 1 means the massive stars are more concentrated than average.

**Why it is cheap.** Prim's algorithm on a complete graph of ~20 nodes is ~400
operations. Fifty draws for the error band is ~20k operations — microseconds.
Recomputing on every slider input is free.

**Why it is worth building.** Moving λ_corr now has a consequence readable off a
plot, and the piece can be *inverted*: "an observer reports Λ_MSR = 1.6 — what
λ_corr does that imply?" That is the actual scientific move, and no live Λ_MSR
calculator appears to exist on the web.

**Data.** Nothing new. `stars.f32` and `local_density.f32` already ship, and
`makeSegregator` already re-pairs masses to positions in the browser.

**Open:** whether to plot Λ_MSR against N_MST (the standard presentation, which
shows segregation is scale-dependent) or a single number at fixed N. The curve
is more honest and more interesting; the single number is easier to read.

---

## 2. New: the IMF dice

**The idea.** Sample an IMF live at a chosen cluster mass and show that in a
small cluster, whether you get an O star *at all* is close to a coin flip — and
that the ionizing-photon budget swings by orders of magnitude between otherwise
identical draws.

**Why it belongs on this site.** Stellar feedback is set almost entirely by the
rare massive tail. This is the framing the rest of the site assumes and never
states, and it is a genuine surprise: two clusters of the same mass can have
radically different feedback because sampling is stochastic.

**Why it is the cheapest thing here.** Canvas 2D, no WebGL, no new export, no
solver. Sampling an IMF is a few lines. The highest surprise-per-byte of
anything in the backlog, and the natural one to build first while the survival
piece is blocked.

**Interaction.** A cluster-mass slider and a re-roll button. Readouts: number of
O stars, most massive star, total ionizing luminosity. Rolling repeatedly at
fixed mass is the whole point — the variance *is* the result.

**Care required.** The ionizing budget must come from a real Q(M) relation, not
a made-up scaling, and must be cited. `startrax` or the ZAMS relations already
used in `export_cluster.py` (`zams_effective_temperature`, `zams_radius`) are
the natural sources. Do not invent a fit.

---

## 3. Later: synthetic observation mode

Project the same truth-known cluster through extinction, a PSF, and a pixel
scale — "what would JWST actually see?"

This is the most distinctive thing the site could offer, because it closes the
model → observation → inference loop and reuses everything already built. It is
also the biggest job of the three, and it should follow the two above.

It overlaps the paused `/explore/inference` piece (see
`2026-07-19-explore-cluster-suite-design.md`), which is waiting on startrax.
Worth deciding whether they are one piece or two before either starts.

---

## Constraint inherited from the survival piece

Anything that animates a simulation must respect the accessibility findings in
`2026-07-20-cluster-survival-design.md`: never animate a violent relaxation,
honor `prefers-reduced-motion` in the simulation loop and not only in the
renderer, and verify flash rate by sampling real rendered frames. A published
page carried a photosensitive-seizure hazard for exactly this reason.

None of the three pieces above currently plans to animate a collapse, so this is
a guard rather than an active constraint.
