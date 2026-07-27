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
import { createDirectForce, softeningForCluster, DIRECT_STEPS_PER_TCROSS } from "./index.ts";
import { createMeanFieldForce } from "../meanField/index.ts";
import { createLeapfrog } from "../integrate.ts";
import { clusterState, combineStates, removeBulkMotion } from "../ic.ts";
import { crossingTime, measure } from "../diagnostics.ts";
import { radii } from "../quantities.ts";
import { defaultIdentity } from "../../cluster/params.ts";
import type { ForceModel, State } from "../types.ts";

const N = 400;
const SCALE_PC = 0.5;

function cluster(seed: number, target = N, scaleRadius = SCALE_PC): State {
  const id = defaultIdentity({
    seed,
    sampling: { mode: "count", target },
    profile: { kind: "plummer", scaleRadius },
    kinematics: { virialRatio: 0.5 },
  });
  const force = createDirectForce({ softening: softeningForCluster(scaleRadius * 1.305, target) });
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
 * milliseconds — the segregation case alone runs six 400-star clusters for twenty crossing
 * times each. Vitest's 5 s default put it right on the boundary: it passed alone at 4.7 s and
 * failed under parallel load at 5.8 s, which is a flaky test that would fail intermittently in
 * CI for reasons having nothing to do with the physics.
 *
 * The timeout is raised rather than the work reduced. N and the duration were chosen to make
 * the segregation signal measurable at all (see the table in the first test), and trimming
 * them to fit an arbitrary limit would quietly weaken the thing being demonstrated.
 */
describe("direct/ produces what only a collisional model can", { timeout: 120_000 }, () => {
  it("segregates by mass — and meanField, on identical ICs, does not", () => {
    /* THE HEADLINE CAPABILITY, and it took three attempts to measure honestly.
     *
     * WHAT DOES NOT WORK. The obvious statistic — mean radius of the heavy decile against the
     * rest — is dominated by escapers and moves the WRONG way: measured 1.128 -> 1.203 over
     * twenty crossing times, in a run where segregation was plainly happening. Switching to a
     * median fixes the direction but still fails to discriminate: `meanField` shows the same
     * fall, sometimes larger (-37.2% against direct's -10.6% on seed 31337). A decile median
     * over 40 stars in an expanding cluster is simply too noisy to separate the models, and a
     * test built on it would have "demonstrated" segregation in a model that has no term for
     * it.
     *
     * WHAT DOES. The rank correlation between MASS and RADIUS, over all bound stars. In
     * `meanField` a star's mass cancels out of its own acceleration, so its trajectory cannot
     * depend on it and this correlation cannot become systematically negative. In `direct` the
     * pair sum lets heavy stars transfer energy to light ones and settle inward, so it must.
     *
     * Measured over four seeds, t = 0 -> 20 crossing times:
     *
     *       seed    direct              meanField
     *      31337    -0.027 -> -0.107    -0.019 -> -0.061
     *          7     0.069 -> -0.114     0.069 ->  0.022
     *       2026    -0.060 -> -0.114    -0.057 -> -0.077
     *        555     0.012 -> -0.126     0.019 -> -0.074
     *
     * direct lands at -0.11..-0.13 every time; meanField scatters about -0.05, which is ~1
     * sigma for n ~ 380 (1/sqrt(n) = 0.051). The signal is MODEST at this N and duration, and
     * saying so matters — what makes it solid is that the comparison is PAIRED: the same
     * initial conditions through both force laws, with direct more negative in every case.
     */
    const seeds = [31337, 7, 2026];
    const finalRho = (kind: "direct" | "meanField"): number[] =>
      seeds.map((seed) => {
        const s = cluster(seed);
        const force =
          kind === "direct"
            ? createDirectForce({ softening: softeningForCluster(SCALE_PC * 1.305, N) })
            : createMeanFieldForce(s.n, { rMin: 1e-3, rMax: 100 });
        const tCross = crossingTime(s);
        const lf = createLeapfrog(s, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });
        for (let i = 0; i < 20; i++) lf.step(tCross);
        return massRadiusCorrelation(s, force);
      });

    const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
    const direct = finalRho("direct");
    const meanField = finalRho("meanField");

    // Heavy stars end up inner in the collisional model. Measured mean -0.116.
    expect(mean(direct)).toBeLessThan(-0.08);
    // …and more so than in the collisionless one. Measured gap 0.068; bound at 0.03.
    expect(mean(direct)).toBeLessThan(mean(meanField) - 0.03);
    // The paired comparison holds seed by seed, not only on average.
    for (let i = 0; i < seeds.length; i++) expect(direct[i]).toBeLessThan(meanField[i]);
  });

  it("produces escapers: stars leave, and they leave from a collisional model", () => {
    /* Two-body encounters can kick a star above the escape speed. `meanField/` has no
       mechanism for this at all — with a smooth potential and no relaxation, a bound star
       stays bound short of the cluster's own expansion. */
    const s = cluster(4242);
    const force = createDirectForce({ softening: softeningForCluster(SCALE_PC * 1.305, N) });
    const tCross = crossingTime(s);
    const boundBefore = measure(s, force).boundFraction;

    const lf = createLeapfrog(s, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });
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
     * Asserted on the SEPARATION OF THE TWO GROUPS' centroids, which is the quantity that only
     * exists because the clumps are tracked as distinct populations.
     */
    const a = cluster(11, 200, 0.3);
    const b = cluster(22, 200, 0.3);
    const merged = combineStates([
      { state: a, place: { offset: [-2, 0, 0], velocity: [0.15, 0, 0] } },
      { state: b, place: { offset: [2, 0, 0], velocity: [-0.15, 0, 0] } },
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

    const before = separationNow();
    expect(before).toBeGreaterThan(3.5); // they start apart

    const force = createDirectForce({ softening: softeningForCluster(0.4, 400) });
    const tCross = crossingTime(merged);
    const lf = createLeapfrog(merged, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });

    /* THREE crossing times, and the window matters. Measured separation against t/t_cross:
     *
     *     0     1     2     3     5     10    20    30
     *     4.00  0.88  1.08  1.16  1.34  2.56  5.27  7.59
     *
     * They merge within ONE crossing time and then the merged cluster slowly evaporates,
     * letting the two tracer groups diffuse apart again. An earlier version of this test ran
     * for 30 and concluded they had flown apart — it was measuring the aftermath, not the
     * merger. Watch the minimum too, so "they came together" is asserted directly.
     */
    let closest = before;
    for (let i = 0; i < 12; i++) {
      lf.step(tCross / 4);
      closest = Math.min(closest, separationNow());
    }
    expect(closest).toBeLessThan(before / 3); // measured minimum 0.88 against 4.00
    expect(separationNow()).toBeLessThan(before / 2.5); // still merged at t = 3
  });

  it("conserves energy across a long run at the measured step density", () => {
    /* The provenance of DIRECT_STEPS_PER_TCROSS, asserted rather than only documented.
       Measured drift over 10 crossing times at 128 steps: 1.3e-5, 1.4e-5 and 5.4e-6 across
       three seeds. The bound is 1e-3 — nearly two orders of headroom — because the point is
       to catch a step density that has become wrong, not to pin a chaotic number. */
    const s = cluster(2026);
    const force = createDirectForce({ softening: softeningForCluster(SCALE_PC * 1.305, N) });
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });
    const e0 = lf.energy().total;
    for (let i = 0; i < 10; i++) lf.step(tCross);
    expect(Math.abs(lf.energy().total - e0) / Math.abs(e0)).toBeLessThan(1e-3);
  });

  it("TEETH: eight steps per crossing time fails the bound that 128 passes", () => {
    /* Proof that the previous assertion discriminates. Measured at 8 steps: 3.2e-1, 5.2e-2 and
       2.7e-1 across the same three seeds — three to four orders worse. If this ever stops
       failing, the energy bound above has stopped meaning anything. */
    const s = cluster(2026);
    const force = createDirectForce({ softening: softeningForCluster(SCALE_PC * 1.305, N) });
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / 8 });
    const e0 = lf.energy().total;
    for (let i = 0; i < 10; i++) lf.step(tCross);
    expect(Math.abs(lf.energy().total - e0) / Math.abs(e0)).toBeGreaterThan(1e-3);
  });
});

describe("softeningForCluster", () => {
  it("is the mean interparticle separation, scaled by an explicit fraction", () => {
    // r_h = 1 pc, N = 1000 -> d = 0.1 pc.
    expect(softeningForCluster(1, 1000)).toBeCloseTo(0.1, 12);
    expect(softeningForCluster(1, 1000, 0.01)).toBeCloseTo(0.001, 12);
    // N^(-1/3): MORE stars means a SMALLER separation, hence smaller softening.
    expect(softeningForCluster(1, 8000)).toBeLessThan(softeningForCluster(1, 1000));
  });
});
