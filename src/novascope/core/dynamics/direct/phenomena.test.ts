/*
 * phenomena.test.ts — does `direct/` actually DO the things it is justified by?
 *
 * The whole argument for carrying a second, O(N^2) force model is that it shows what
 * `../meanField/` structurally cannot: dynamical mass segregation, escapers, and any
 * configuration that is not spherically symmetric. Until this file existed those were claims
 * in a header with nothing behind them — the 2026-07-26 review flagged exactly that, and it is
 * the difference between a comment and a result.
 *
 * Each test therefore demonstrates a PHENOMENON and, where it matters, shows the mean-field
 * model failing to reproduce it. A test that only checked `direct` in isolation would not
 * establish the thing the two-model design is for.
 *
 * Runtimes are kept to a few seconds by using N in the hundreds, which is the honest N for
 * this model anyway (see `DIRECT_STEPS_PER_TCROSS` and the cost table in `./index.ts`).
 */
import { describe, expect, it } from "vitest";
import { createDirectForce, softeningForCluster, stepsForSoftening } from "./index.ts";
import { createFsi4 } from "../fsi4.ts";
import { clusterState, combineStates, removeBulkMotion } from "../ic.ts";
import { crossingTime, lagrangianRadii, measure } from "../diagnostics.ts";
import { radii } from "../quantities.ts";
import { defaultIdentity } from "../../cluster/params.ts";
import type { ForceModel, State } from "../types.ts";

const N = 400;
const SCALE_PC = 0.5;
/* The collisional default (see `softeningForCluster`), with the step derived from it rather
   than fixed — the two are coupled, and holding one while changing the other is exactly the
   confound that produced a wrong conclusion once already. */
const FRACTION = 0.5;
const STEPS = stepsForSoftening(FRACTION);

function cluster(seed: number, target = N, scaleRadius = SCALE_PC): State {
  const id = defaultIdentity({
    seed,
    sampling: { mode: "count", target },
    profile: { kind: "plummer", scaleRadius },
    kinematics: { virialRatio: 0.5 },
  });
  const force = createDirectForce({ softening: softeningForCluster(scaleRadius * 1.305, target, FRACTION) });
  return clusterState(id, force);
}

/**
 * Spearman rank correlation between mass and radius, over the BOUND stars.
 *
 * Bound only, because escapers are a different population — they are on their way out and
 * their radii say more about when they left than about where they sit. Rank rather than
 * linear, because neither mass nor radius is normally distributed and a couple of 20 Msun
 * stars would otherwise set the answer.
 *
 * Negative means heavy stars are more centrally concentrated, i.e. segregated.
 */
function massRadiusCorrelation(s: State, force: ForceModel): number {
  const r = new Float64Array(s.n);
  radii(s, r);
  const d = measure(s, force);
  const keep: number[] = [];
  for (let i = 0; i < s.n; i++) if (d.bound[i]) keep.push(i);

  const rank = (v: number[]): number[] => {
    const idx = [...v.keys()].sort((a, b) => v[a] - v[b]);
    const out = new Array<number>(v.length);
    idx.forEach((k, i) => (out[k] = i));
    return out;
  };
  const rm = rank(keep.map((i) => s.mass[i]));
  const rr = rank(keep.map((i) => r[i]));
  let sd = 0;
  for (let i = 0; i < rm.length; i++) sd += (rm[i] - rr[i]) ** 2;
  return 1 - (6 * sd) / (rm.length * (rm.length ** 2 - 1));
}

/*
 * These integrate real clusters for tens of crossing times, so they cost SECONDS, not
 * milliseconds — the segregation case alone runs five 400-star clusters for twenty crossing
 * times each. Vitest's 5 s default put it right on the boundary: it passed alone at 4.7 s and
 * failed under parallel load at 5.8 s, which is a flaky test that would fail intermittently in
 * CI for reasons having nothing to do with the physics.
 *
 * The timeout is raised rather than the work reduced. N and the duration were chosen to make
 * the segregation signal measurable at all (see the table in the first test), and trimming
 * them to fit an arbitrary limit would quietly weaken the thing being demonstrated.
 *
 * RAISED AGAIN 2026-07-27, 120 s -> 300 s, and the reason is the same one twice over. The whole
 * file measures 72 s on an idle machine; under a concurrent build it exceeded 120 s and failed.
 * A limit only 1.7x above the quiet runtime is not a timeout, it is a load detector — and the
 * failure it produces points at the physics, which is where a session then goes looking.
 *
 * The cost also grew for a real reason rather than by drift: `stepsForSoftening` derives the
 * step from the softening fraction, and the 2026-07-26 move to the collisional default
 * (fraction 1 -> 0.5) took the step density from 128 to 181 per crossing time. That is 1.4x more
 * work, bought deliberately.
 */
describe("direct/ produces what only a collisional model can", { timeout: 300_000 }, () => {
  it("segregates by mass, measured against its own initial state", () => {
    /* THE HEADLINE CAPABILITY. Massive stars transfer energy to lighter ones in two-body
     * encounters and settle inward. It is not put in anywhere; it emerges from the pair sum.
     *
     * ── THE CONTROL IS WITHIN-MODEL, AND THAT TOOK FOUR ATTEMPTS TO GET RIGHT ──
     *
     * Earlier versions compared `direct` against `meanField` on identical ICs. That premise
     * was wrong: meanField is not a star-dynamics model. It is the engine of
     * `../gasExpulsion/`, where a spherically-averaged potential is the cited semi-analytic
     * treatment for a draining gas cloud at N = 10,301. Benchmarking stellar segregation
     * against it was comparing the right model to one that should not be modelling stars.
     *
     * The comparison was also never stable. The statistic changed three times (mean radius ->
     * median -> rank correlation), and each fix surfaced a new confound somewhere else — the
     * last being that changing the softening changed the VIRIAL SCALING in the initial
     * conditions, so both arms silently started from different clusters.
     *
     * The honest control is the cluster's own t = 0. Masses are assigned independently of
     * position (`segregation: 0`), so rho starts at zero within sampling noise and must become
     * negative if relaxation is happening. No second model, no cross-model confound.
     *
     * Measured, FSI4 at the collisional softening, five seeds over 20 crossing times:
     *
     *     seed     rho(0)    rho(20)    delta     |dE/E|
     *     31337   -0.0265   -0.0639   -0.0374    1.8e-5
     *         7    0.0686   -0.0998   -0.1684    7.3e-6
     *      2026   -0.0607   -0.1172   -0.0565    1.1e-7
     *       555    0.0170   -0.0951   -0.1121    1.2e-7
     *        11    0.0175   -0.0482   -0.0657    1.6e-5
     *
     *     mean delta = -0.0880 +/- 0.0236, every seed negative
     *
     * Why meanField CANNOT do this is proved separately and deterministically, in
     * `../meanField/meanField.test.ts` — a star's mass cancels out of its own acceleration, so
     * mass and radius cannot become correlated by the dynamics. That is a structural fact and
     * needs no statistics at all.
     */
    const seeds = [31337, 7, 2026, 555, 11];
    const deltas = seeds.map((seed) => {
      const s = cluster(seed);
      const force = createDirectForce({
        softening: softeningForCluster(SCALE_PC * 1.305, N, FRACTION),
      });
      const tCross = crossingTime(s);
      const before = massRadiusCorrelation(s, force);
      const it = createFsi4(s, force, { maxStep: tCross / STEPS });
      for (let i = 0; i < 20; i++) it.step(tCross);
      return massRadiusCorrelation(s, force) - before;
    });

    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    // Measured -0.0880 +/- 0.0236, i.e. 3.7 sigma from zero. Bound at -0.03.
    expect(mean).toBeLessThan(-0.03);
    // And non-parametrically: every seed moves the same way.
    for (const d of deltas) expect(d).toBeLessThan(0);
  });

  it("produces escapers: stars leave, and they leave from a collisional model", () => {
    /* Two-body encounters can kick a star above the escape speed. `meanField/` has no
       mechanism for this at all — with a smooth potential and no relaxation, a bound star
       stays bound short of the cluster's own expansion. */
    const s = cluster(4242);
    const force = createDirectForce({ softening: softeningForCluster(SCALE_PC * 1.305, N, FRACTION) });
    const tCross = crossingTime(s);
    const boundBefore = measure(s, force).boundFraction;

    const lf = createFsi4(s, force, { maxStep: tCross / STEPS });
    for (let i = 0; i < 25; i++) lf.step(tCross);
    const boundAfter = measure(s, force).boundFraction;

    expect(boundBefore).toBeGreaterThan(0.9); // virialized to start
    expect(boundAfter).toBeLessThan(boundBefore); // some got out
    expect(boundAfter).toBeGreaterThan(0.5); // but it did not disintegrate
  });

  it("merges two clumps — the configuration meanField cannot even represent", () => {
    /* The cheapest demonstration that the two models are different EQUATIONS. Two Plummer
     * spheres, offset and falling together, are not spherically symmetric about any origin.
     * `direct/` resolves them as two centres that approach and merge; `meanField/` would bin
     * both into shells about the origin and collapse them radially, which looks plausible and
     * is not what is happening.
     *
     * ── THIS TEST FAILED IN CI FOR ELEVEN COMMITS, AND THE REASON IS THE INTERESTING PART ──
     *
     * It asserted `separation(t=3) < before/2.5`, i.e. 1.6, against a single measurement of 1.16.
     * CI measured 1.708 and the deploy was blocked. Two independent things were wrong, and both
     * had to be understood before the bound could be set honestly.
     *
     * FIRST, THE QUANTITY IS NOISY. The separation of the two tracer groups' centroids at t = 3
     * is a small difference of two large fluctuating numbers, taken AFTER the groups have already
     * interpenetrated. Measured over six seed pairs it runs
     *
     *     0.593  1.089  1.219  1.223  1.267  2.587
     *
     * — a factor of 4.4, with the old bound of 1.6 sitting in the middle of the distribution. It
     * was a coin flip on any machine.
     *
     * SECOND, THE TRAJECTORY IS NOT PORTABLE. CI runs Node 24, this machine runs Node 26. V8's
     * Math.sin/cos/log differ in the last bits between versions, `ic.ts` draws its positions and
     * Box-Muller velocities through them, and a 400-body integration is chaotic — so identical
     * inputs give genuinely different trajectories. Same seed, same commit: 1.089 here, exactly
     * 1.708 there (byte-identical across four CI runs, so each machine is internally
     * deterministic). That is not a defect to fix; it is a property to design around.
     *
     * ── SO THE ASSERTIONS ARE CHOSEN FOR ROBUSTNESS TO A DIFFERENT TRAJECTORY ──
     *
     * Every bound below is either derived from what the alternative outcome would give, or set
     * against a MEASURED spread across six realizations — never against one number.
     *
     *     seeds     sepMin  sep@3 |   rh0   rhMin  rhMin/rh0
     *     11/22      0.532  1.089 | 2.087  0.562      0.269
     *     3/4        0.628  1.223 | 2.007  0.568      0.283
     *     101/202    0.332  1.267 | 1.800  0.828      0.460
     *     7/8        0.372  0.593 | 1.995  0.615      0.308
     *     55/66      0.530  2.587 | 2.021  0.611      0.302
     *     2026/99    0.314  1.219 | 2.076  0.737      0.355
     *
     * Note what is NOT used. The bound mass fraction is beautifully stable (0.861-0.940 across
     * all six) and was rejected anyway: two clumps that pass through each other each stay
     * internally bound, so it cannot tell a merger from a fly-through. Stability is not the same
     * as discrimination.
     *
     * ── TEETH, DEMONSTRATED BY BREAKING IT ──
     *
     *   clumps given outward velocities (never approach)  -> closest = 4.00 vs bound 1.33, FAILS
     *   clumps given 10x inbound speed (fly through)      -> mean final 41.2 vs bound 4.0, FAILS
     *
     * The second is the one that matters, and it is why a late-time assertion has to exist at
     * all: in the fly-through the `closest` check PASSES, because they really do approach. Merger
     * 1.33 against fly-through 41.2 puts the bound between outcomes an order of magnitude apart.
     *
     * HONEST LIMIT: the r_h check below is a CROSS-CHECK, not a demonstrated gate. I could not
     * construct a failure mode for it distinct from the `closest` check — clumps made so diffuse
     * they already overlap at +/-2 still concentrate, measuring 0.544 against its 0.7 bound. It
     * is kept because it watches the mass distribution rather than two tracer centroids, which is
     * an independent quantity; it is labelled rather than advertised as something it is not.
     */
    const PAIRS = [
      [11, 22],
      [3, 4],
      [101, 202],
      [7, 8],
      [55, 66],
      [2026, 99],
    ] as const;

    const finalSeparations: number[] = [];

    for (const [seedA, seedB] of PAIRS) {
      const merged = combineStates([
        { state: cluster(seedA, 200, 0.3), place: { offset: [-2, 0, 0], velocity: [0.15, 0, 0] } },
        { state: cluster(seedB, 200, 0.3), place: { offset: [2, 0, 0], velocity: [-0.15, 0, 0] } },
      ]);
      removeBulkMotion(merged);

      const centroid = (from: number, to: number): number => {
        let m = 0;
        let x = 0;
        for (let i = from; i < to; i++) {
          m += merged.mass[i];
          x += merged.mass[i] * merged.pos[i * 3];
        }
        return x / m;
      };
      const separationNow = (): number => Math.abs(centroid(0, 200) - centroid(200, 400));
      /* Half-mass radius of the COMBINED system: median-like over all 400 stars rather than a
         difference of two centroids, so realization noise averages down instead of up. Measured
         spread 60% against the centroid separation's 336%. */
      const halfMass = (): number => lagrangianRadii(merged, [0.5])[0];

      const before = separationNow();
      expect(before).toBeGreaterThan(3.5); // they start apart
      const rh0 = halfMass();

      const force = createDirectForce({ softening: softeningForCluster(0.4, 400, FRACTION) });
      const tCross = crossingTime(merged);
      const lf = createFsi4(merged, force, { maxStep: tCross / STEPS });

      /* THREE crossing times, and the window matters: they merge within ONE, and the merged
         cluster then evaporates, letting the tracer groups diffuse apart again. An earlier
         version ran for 30 and concluded they had flown apart — it was measuring the aftermath,
         not the merger. */
      let closest = before;
      let tightest = rh0;
      for (let i = 0; i < 12; i++) {
        lf.step(tCross / 4);
        closest = Math.min(closest, separationNow());
        tightest = Math.min(tightest, halfMass());
      }

      // THEY APPROACHED. Worst measured 0.628 against this bound of 1.333 — 2.1x headroom.
      expect(closest).toBeLessThan(before / 3);

      /* THEY BECAME ONE OBJECT, not two that happened to overlap — a cross-check on the mass
         distribution rather than on the tracer centroids (see the HONEST LIMIT note above). r_h
         starts near 2.0 because the median star sits at the clump offset; once merged it is the
         combined cluster's own half-mass radius, ~0.5-0.8. The 0.7 threshold is where the median
         star is nearer the centre than the offsets are — one object rather than two — and every
         realization measured 0.46 or below. */
      expect(tightest / rh0).toBeLessThan(0.7);

      finalSeparations.push(separationNow());
    }

    /* THEY DID NOT SIMPLY PASS THROUGH. Derived rather than fitted: the clumps approach at a
       relative 0.3 pc/Myr and t_cross is ~5.2 Myr, so a fly-through would carry them ~4.7 pc
       apart by t = 3 t_cross — FURTHER than the 4.0 they started at, and still growing. Staying
       below the initial separation is therefore the discriminating statement.

       Asserted on the MEAN over six realizations, because this is the noisy quantity: the mean
       measures 1.33 here, and the worst single realization is 2.587. Averaging is what makes a
       chaotic observable testable at all. */
    const meanFinal = finalSeparations.reduce((a, b) => a + b, 0) / finalSeparations.length;
    expect(meanFinal).toBeLessThan(4.0);
  });

  it("conserves energy across a long run at the measured step density", () => {
    /* The provenance of DIRECT_STEPS_PER_TCROSS, asserted rather than only documented.
       Measured drift over 10 crossing times at 128 steps: 1.3e-5, 1.4e-5 and 5.4e-6 across
       three seeds. The bound is 1e-3 — nearly two orders of headroom — because the point is
       to catch a step density that has become wrong, not to pin a chaotic number. */
    const s = cluster(2026);
    const force = createDirectForce({ softening: softeningForCluster(SCALE_PC * 1.305, N, FRACTION) });
    const tCross = crossingTime(s);
    const lf = createFsi4(s, force, { maxStep: tCross / STEPS });
    const e0 = lf.energy().total;
    for (let i = 0; i < 10; i++) lf.step(tCross);
    expect(Math.abs(lf.energy().total - e0) / Math.abs(e0)).toBeLessThan(1e-3);
  });

  it("TEETH: eight steps per crossing time fails the bound that 128 passes", () => {
    /* Proof that the previous assertion discriminates. Measured at 8 steps: 3.2e-1, 5.2e-2 and
       2.7e-1 across the same three seeds — three to four orders worse. If this ever stops
       failing, the energy bound above has stopped meaning anything. */
    const s = cluster(2026);
    const force = createDirectForce({ softening: softeningForCluster(SCALE_PC * 1.305, N, FRACTION) });
    const tCross = crossingTime(s);
    const lf = createFsi4(s, force, { maxStep: tCross / 8 });
    const e0 = lf.energy().total;
    for (let i = 0; i < 10; i++) lf.step(tCross);
    expect(Math.abs(lf.energy().total - e0) / Math.abs(e0)).toBeGreaterThan(1e-3);
  });
});

