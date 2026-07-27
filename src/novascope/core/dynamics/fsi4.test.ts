/*
 * fsi4.test.ts — is it actually fourth order?
 *
 * That is the only question worth asking of a ported integrator, and its name is not evidence.
 * The test measures the CONVERGENCE ORDER directly: halve the step, and a second-order scheme's
 * error falls by 4 while a fourth-order scheme's falls by 16.
 *
 * ── THE FIRST VERSION OF THIS TEST WAS USELESS, AND THE REASON IS INSTRUCTIVE ──
 *
 * It used a CIRCULAR orbit and measured |E(end) - E(0)|. On a circular orbit the speed and the
 * acceleration magnitude are constant, the periodic part of a symplectic integrator's energy
 * error cancels after a whole number of periods, and what is left is not the error being
 * measured. FSI4 hit 4.4e-16 at the coarsest step — nothing left to converge — and leapfrog
 * reported ratios near 270, which is not second order or any other order.
 *
 * An ECCENTRIC orbit sampled for its MAXIMUM error over the run fixes both: the error does not
 * cancel, and the peak near periapsis is where the scheme is actually tested.
 */
import { describe, expect, it } from "vitest";
import { createFsi4, supportsForceGradient } from "./fsi4.ts";
import { createLeapfrog } from "./integrate.ts";
import { createDirectForce } from "./direct/index.ts";
import { createMeanFieldForce } from "./meanField/index.ts";
import { chooseIntegrator } from "./choose.ts";
import { KEPLER, KEPLER_PERIOD, keplerPair } from "./kepler.testutil.ts";
import { createState } from "./types.ts";

/* The two-body fixture is SHARED with `hermite.test.ts` (`./kepler.testutil.ts`). It used to be
   defined locally here, and that local copy was wrong in a way worth recording: its apoapsis
   speed used sqrt(G m (1-e)/(a(1+e))) where the two-body relative orbit needs total mass 2m, so
   the orbit it actually ran was a = 0.857, e = 0.75 rather than the a = 1, e = 0.5 it claimed,
   and `PERIOD` was 4.443 against the true 3.526 — "four periods" was really 5.04.

   The CONVERGENCE MEASUREMENT was unaffected: an error-ratio at halved steps over a fixed span
   on a fixed bound orbit measures the order whatever a and e happen to be. What was wrong was
   the label. The numbers below were re-measured on the corrected fixture. */
const G = KEPLER.G;
const EPS = KEPLER.softening;
const twoBody = keplerPair;
const PERIOD = KEPLER_PERIOD;

/** Peak |dE/E0| over four orbits at a given step density. */
function peakEnergyError(
  make: typeof createLeapfrog | typeof createFsi4,
  stepsPerPeriod: number,
): number {
  const s = twoBody();
  const force = createDirectForce({ softening: EPS, G });
  const it = make(s, force, { maxStep: PERIOD / stepsPerPeriod });
  const e0 = it.energy().total;
  let worst = 0;
  const samples = stepsPerPeriod * 4;
  for (let i = 0; i < samples; i++) {
    it.step((4 * PERIOD) / samples);
    worst = Math.max(worst, Math.abs(it.energy().total - e0) / Math.abs(e0));
  }
  return worst;
}

describe("createFsi4", () => {
  it("converges at FOURTH order, where the leapfrog converges at second", () => {
    /* THE TEST THAT JUSTIFIES THE PORT. Measured, e = 0.5, four periods:
     *
     *     steps/period    leapfrog    ratio     FSI4        ratio
     *              64     5.79e-1       --      4.99e-2       --
     *             128     1.79e-1      3.2      8.18e-4     61.0
     *             256     4.97e-2      3.6      5.07e-5     16.1
     *             512     1.27e-2      3.9      3.13e-6     16.2
     *            1024     3.18e-3      4.0      1.95e-7     16.1
     *
     * Both land on their theoretical ratios once the asymptotic regime is reached. FSI4's 61
     * at the coarsest halving is pre-asymptotic — the step is still too large for the
     * expansion to hold — which is itself the expected shape.
     */
    const ratios = (make: typeof createLeapfrog | typeof createFsi4): number[] => {
      const out: number[] = [];
      let previous: number | null = null;
      for (const spp of [256, 512, 1024]) {
        const e = peakEnergyError(make, spp);
        if (previous !== null) out.push(previous / e);
        previous = e;
      }
      return out;
    };

    // Second order: 4 per halving. Bounds bracket the measured 3.9 and 4.0.
    for (const r of ratios(createLeapfrog)) {
      expect(r).toBeGreaterThan(3.2);
      expect(r).toBeLessThan(5.5);
    }
    // Fourth order: 16 per halving. Measured 16.1 and 16.2 — a factor of four better SCALING,
    // which is the whole claim.
    for (const r of ratios(createFsi4)) {
      expect(r).toBeGreaterThan(11);
      expect(r).toBeLessThan(22);
    }
  });

  it("is far more accurate than the leapfrog at equal COST, not just at equal step", () => {
    /* The honest comparison. FSI4 costs ~4 pairwise passes per step (two accelerations plus a
       gradient, which is itself two passes) against the leapfrog's one. So four times the step
       count is the fair trade — and even there FSI4 wins by a wide margin: measured 5.07e-5 at
       256 steps against the leapfrog's 3.18e-3 at 1024, a factor of 63. */
    const fsi4AtQuarterTheSteps = peakEnergyError(createFsi4, 256);
    const leapfrogAtFullSteps = peakEnergyError(createLeapfrog, 1024);
    expect(fsi4AtQuarterTheSteps).toBeLessThan(leapfrogAtFullSteps / 10);
  });

  it("refuses a force model that cannot supply a force gradient, loudly", () => {
    /* meanField's force comes from a binned radial profile, which has no pair structure to
       differentiate. Falling back to leapfrog silently would let a caller believe it was
       running a fourth-order scheme and misread every convergence result it produced. */
    const s = twoBody();
    const meanField = createMeanFieldForce(s.n, { G, rMin: 1e-3, rMax: 100 });
    expect(supportsForceGradient(meanField)).toBe(false);
    expect(() => createFsi4(s, meanField)).toThrow(/forceGradient/);

    expect(supportsForceGradient(createDirectForce({ softening: EPS, G }))).toBe(true);
  });

  it("advances time by exactly the requested amount, across sub-steps", () => {
    const s = twoBody();
    const force = createDirectForce({ softening: EPS, G });
    const it = createFsi4(s, force, { maxStep: PERIOD / 64 });
    it.step(PERIOD);
    expect(it.t).toBeCloseTo(PERIOD, 9);
    it.step(PERIOD / 3);
    expect(it.t).toBeCloseTo(PERIOD * (4 / 3), 9);
  });

  it("reports an energy whose potential comes from the force model", () => {
    const s = twoBody();
    const force = createDirectForce({ softening: EPS, G });
    const it = createFsi4(s, force);
    const e = it.energy();
    expect(e.potential).toBe(force.potentialEnergy(s.pos, s.mass, 0));
    expect(e.total).toBeCloseTo(e.kinetic + e.potential, 12);
    // A bound orbit: total energy is negative.
    expect(e.total).toBeLessThan(0);
  });
});

describe("direct/'s force gradient", () => {
  it("vanishes for a single particle, which has nothing to be gradient-corrected against", () => {
    const s = createState(1);
    s.mass[0] = 1;
    const force = createDirectForce({ softening: EPS, G });
    const acc = new Float64Array(3);
    const grad = new Float64Array(3);
    force.forceGradient!(s.pos, s.mass, acc, grad, 0);
    for (let i = 0; i < 3; i++) expect(grad[i]).toBe(0);
  });

  it("is antisymmetric for an equal-mass pair, as the symmetry demands", () => {
    /* Two identical particles: whatever correction one gets, the other must get the mirror
       image. Any sign or index slip in the pair loop breaks this immediately. */
    const s = createState(2);
    s.mass[0] = 1;
    s.mass[1] = 1;
    s.pos[0] = -0.5;
    s.pos[3] = 0.5;
    s.pos[1] = 0.2;
    s.pos[4] = -0.2;
    const force = createDirectForce({ softening: 0.01, G });
    const acc = new Float64Array(6);
    const grad = new Float64Array(6);
    force.forceGradient!(s.pos, s.mass, acc, grad, 0);
    for (let k = 0; k < 3; k++) expect(grad[k]).toBeCloseTo(-grad[3 + k], 12);
  });

  it("returns the SAME accelerations as the plain kernel", () => {
    /* forceGradient computes the acceleration on its way to the gradient. If the two ever
       disagreed, FSI4's outer kicks and middle kick would be stepping different physics. */
    const s = twoBody();
    const force = createDirectForce({ softening: 0.01, G });
    const plain = new Float64Array(6);
    const both = new Float64Array(6);
    const grad = new Float64Array(6);
    force.accelerations(s.pos, s.mass, plain, 0);
    force.forceGradient!(s.pos, s.mass, both, grad, 0);
    for (let i = 0; i < 6; i++) expect(both[i]).toBe(plain[i]);
  });
});

describe("chooseIntegrator", () => {
  it("defaults to FSI4 where the force model supports it", () => {
    const s = twoBody();
    const picked = chooseIntegrator(s, createDirectForce({ softening: EPS, G }));
    expect(picked.scheme).toBe("fsi4");
    expect(picked.order).toBe(4);
  });

  it("falls back to the leapfrog for meanField — the only scheme it can run", () => {
    /* Not a preference: FSI4 needs forceGradient, which a binned radial profile cannot supply.
       gasExpulsion runs on meanField, so removing the leapfrog would delete that page. */
    const s = twoBody();
    const picked = chooseIntegrator(s, createMeanFieldForce(s.n, { G, rMin: 1e-3, rMax: 100 }));
    expect(picked.scheme).toBe("leapfrog");
    expect(picked.order).toBe(2);
  });

  it("reports which scheme it chose, so a caller never has to assume", () => {
    /* A lab that silently fell back to second order while labelling itself fourth is exactly
       the confidently-wrong readout this codebase keeps designing against. */
    const s = twoBody();
    const forced = chooseIntegrator(s, createDirectForce({ softening: EPS, G }), {
      prefer: "leapfrog",
    });
    expect(forced.scheme).toBe("leapfrog");
    expect(forced.order).toBe(2);
  });
});
