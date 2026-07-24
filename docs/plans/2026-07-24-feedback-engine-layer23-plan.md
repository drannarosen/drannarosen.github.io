# Feedback engine — Layer 2/3 implementation plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:executing-plans to build this
> task-by-task. Layers 0 and 1 are DONE, gated, and pushed. This plan is the
> WebGL evacuation driver (Layer 2) and the interactive page (Layer 3).

**Goal:** ship `/explore/feedback-budget` — a Census-style interactive that shows
the feedback momentum/energy budget against a cluster's binding, drives a gas
evacuation from the real budget, and renders the two-stage verdict.

**Framing (Anna, 2026-07-24):** ship the honest static story (framing A). The
headline is NOT "do they blow apart" (they don't — born-bound); it is "feedback
clears the gas fast, but these clusters are born bound." An SFE/velocity slider
that can drive infant mortality (framing B) is the immediate FOLLOW-ON, not v1.

**Do NOT touch `/explore/gas-expulsion`** — it is the schematic homologous-S
version and the cluster-birth storyline depends on it. This is a NEW page.

---

## What already exists (reuse, do not rebuild)

- **Layer 0** `src/novascope/core/feedback/`: sources, winds, bubble,
  photoionization, radiation, binding, ledger (two-stage verdict), trajectory.
  All pure, all gated by `scripts/check-feedback.mjs`.
- **Layer 1** `src/novascope/state/feedback.ts`: `loadFeedbackRealization(name?, opts?)`
  → `{ meta, input, ledger, trajectory, gasMencFrac, gasMencRMaxPc }`;
  `recomputeFeedback(realization, opts)` for knob changes without refetch.
- **Renderer** `src/novascope/viz/webgl/` (`loadScene`, `createEngine`,
  `attachInteraction`; compat shim `src/lib/cluster.ts`). Loads volume.u8 +
  stars.f32, renders the density volume + stars, camera drag/zoom. The schematic
  gas-expulsion page drives it with a scalar S (homologous ρ→ρ/S³).
- **UI** `src/components/Meter.astro` (SEGMENTED — for discrete status, NOT the
  continuous ratio bars here; build a continuous bar). `PresentFrame.astro` (the
  canvas frame with `stage`/`controls` slots + fullscreen/scrub affordances).
  `PageHeader.astro`. Page template pattern: thin page → big Engine component
  (see `src/pages/explore/census.astro` → `novascope/components/CensusEngine.astro`).
- **Realizations shipped** (6): `diffuse`, `` (root = orion), `compact`,
  `orion-solenoidal`, `orion-compressive`, `orion-shallow`. Fiducial γ_3D=4.2,
  segregated (λ_corr=0.6). Verdicts: all blow-out gas / all survive.

---

## Task 1 — the continuous ratio bar (`RatioBar.astro` or inline)

**Files:** create `src/novascope/components/RatioBar.astro`.

A horizontal bar showing a ratio against a threshold of 1. Unlike `Meter`
(discrete segments), this is continuous and can exceed 1 (log-compress above ~3
so a 25× bar stays on screen). A tick at ratio=1 is the threshold. Fill color
keys to state (bound < 0.8 amber, marginal, blow-out > 1.2 teal — reuse the
verdict palette). Props: `value`, `label`, `thresholdLabel`, `ariaLabel`.

Verify: renders at a few ratios (0.5, 1.0, 7.5, 25) without overflowing its box;
theme-aware (light/dark tokens).

## Task 2 — the two-stage verdict readout (inline in the engine)

Compose two lines from `ledger.gasExpulsion`:
- Stage 1: "Gas {expelled|retained}" + `gasMomentumRatio` ("×N over threshold")
  + regime (`removalRegime`).
- Stage 2: "Cluster {survives|expands|dissolves}" + `qVirialPost`
  ("q = {qVirialPost} after expulsion; bound below 1").
Compose the combined sentence honestly: gas retained → survival is moot (state
"stays embedded"); gas expelled + survives → the born-bound headline.

## Task 3 — the component-vs-time plot (`FeedbackTimePlot`, inline SVG)

**Files:** inline SVG in the engine, or `src/novascope/components/FeedbackTimePlot.astro`.

From `trajectory`: draw `windMomentum`, `hiiMomentum`, `radMomentum`, and
`totalMomentum` vs `tMyr` (four lines, channel colors). Horizontal line at
`gasMomentumNeeded` (the threshold). Vertical reference lines at `tCrossMyr` and
`tRemoveMyr`. Axes in Myr and Msun km/s. Pure SVG (no chart lib — CLAUDE.md).
This is the honest "which channel leads, and when" view — H II is visibly
super-linear, winds/radiation straight.

Verify: the total line ends at `ledger.totalMomentum`; the threshold crossing
sits at `tRemoveMyr`.

## Task 4 — `FeedbackEngine.astro` (the component)

**Files:** create `src/novascope/components/FeedbackEngine.astro`.

Structure mirrors `CensusEngine.astro`:
- `PresentFrame` with a `<canvas data-cluster>` in `stage`.
- Controls slot: a realization picker (6 buttons/select), a scrub slider (time
  0→window), play toggle, and channel toggles (winds/H II/radiation).
- Readouts: two `RatioBar`s (momentum ratio vs M_gas v_esc; energy ratio vs
  E_bind with the γ band), the Task-2 verdict, the Task-3 time plot, and the key
  numbers (window, ψ, f_trap, S, M_gas) quoted from `meta`/`ledger` — NEVER
  retyped (read from the loaded realization).
- **Client script:**
  1. `loadScene(base)` + `createEngine` + `attachInteraction` for the render
     (base = `/data/gravoturb/<name>` or `/data/gravoturb` for root).
  2. `loadFeedbackRealization(name)` for the budget.
  3. Scrub/play drives the render's gas clearing AND the plot's time cursor from
     the SAME `t`. For v1 the render clearing may reuse the existing scalar-S
     path keyed to `clearedFraction(t)` (see Task 5 for the honest upgrade).
  4. Realization picker reloads both scene and budget; channel toggles call
     `recomputeFeedback` and re-render bars/plot/verdict.
- Respect `prefers-reduced-motion` (no autoplay; scrub only), a visible pause,
  text contrast always (CLAUDE.md accessibility).

## Task 5 — the M(<r)-driven evacuation (the honest Layer-2 upgrade)

The schematic page removes gas homologously (uniform S). Replace that driver so
gas is removed by the BUDGET: at scrub time t, clear the gas where the delivered
momentum has overcome the local binding — read `clearedFraction(t)` and weight
the clearing by `gasMencFrac` so the dense core (steep M(<r)) clears LAST and the
tenuous edge first, bounded at `r_t` (never render past the truncation — that is
the "expelled" verdict, and there is no data beyond r_t). This likely means a
shader uniform for a radius-dependent density floor (see `viz/webgl/shaders.ts`),
or a per-voxel clearing field derived from `gasMencFrac`. Keep the scalar-S path
as a fallback if the shader work slips — but the M(<r) version is the one that
matches the ledger, so the animation and the bars cannot tell different stories.

**No cosmetic hacks** (memory): the clearing morphology must come from the model
(clearedFraction + M(<r)), not a hand-drawn mask. Morphology one-cavity vs
swiss-cheese follows `ledger.diagnostics.hii.overlap`.

## Task 6 — `feedback-budget.astro` (the page)

**Files:** create `src/pages/explore/feedback-budget.astro` (thin, ~40 lines,
like `census.astro`): `BaseLayout` + `PageHeader` + `<FeedbackEngine />`. Honest
lede — the born-bound headline, the two-stage framing, and that the shells are
analytic similarity solutions / the budget is an ACCOUNTING tool (the spectacle
makes the accounting legible), not a hydro sim. Title/description per site
conventions. Analytics inherited from BaseLayout — do NOT add tags.

## Task 7 — verify + ship (REQUIRED: site-verify skill)

- `pnpm check` (0 errors/warnings/hints), `pnpm check:novascope`, `pnpm build`,
  `pnpm check:feedback` all green.
- **Browser at 1440x900** (record innerWidth in the same call): page renders,
  cluster loads, scrub drives clearing + plot cursor, picker switches
  realizations, bars/verdict update, no console errors. Screenshot for Anna.
- Search: the crawler indexes the new page automatically (do NOT hand-list it).
- Confirm the deploy goes green (not just that the push succeeded).

---

## Open follow-ons (record, do not build in v1)

- **Framing B:** an SFE / velocity-normalization slider that drives stage 2 into
  "dissolves" (infant mortality). The q<1 criterion is already live and will
  respond; it just needs the knob wired + a re-export path for SFE if it is not
  purely a post-hoc rescale.
- **Time-dependent f_trap** once hydrax lands (shell Σ_sh(t), T_eff,sh(t) → the
  radax trapping module): the radiation curve stops being linear and the f_trap
  decay becomes visible. Seam is ready (radiation reads f_trap as a scalar).
- Decide later whether to fold the schematic gas-expulsion into this page or keep
  both (Anna wants to see this one first).
