/*
 * hermite.test.ts — is the jerk really da/dt, and is the scheme really fourth order?
 *
 * Two questions, and they are separate. The jerk kernel is NEW physics in this package: FSI4
 * and the leapfrog are both built from the same `accelerations`, so a defect there would show
 * up identically in both and they would agree with each other while being wrong together. The
 * jerk is an independent kernel with an independent failure mode, so it gets an independent
 * contract test — differentiated numerically, exactly as `direct.test.ts` does for the
 * force-gradient, and for the same reason: checking the algebra by eye is how a sign slip ships.
 */
import { describe, expect, it } from "vitest";
import { createDirectForce } from "./direct/index.ts";
import { createMeanFieldForce } from "./meanField/index.ts";
import { createHermite, supportsJerk } from "./hermite.ts";
import { availableSchemes, chooseIntegrator } from "./choose.ts";
import { KEPLER, KEPLER_PERIOD, keplerPair, keplerSeparation } from "./kepler.testutil.ts";
import { createState, type State } from "./types.ts";

const G = 1;

/** A fixed, asymmetric, non-degenerate configuration with every particle moving. */
function scattered(n: number): State {
  const s = createState(n);
  for (let i = 0; i < n; i++) {
    s.mass[i] = 0.5 + 0.4 * (i % 4);
    s.pos[i * 3] = Math.cos(i * 1.3) * (1 + (i % 3) * 0.5);
    s.pos[i * 3 + 1] = Math.sin(i * 2.1) * 1.4;
    s.pos[i * 3 + 2] = Math.cos(i * 0.7) * 0.8;
    s.vel[i * 3] = 0.3 * Math.sin(i * 1.1);
    s.vel[i * 3 + 1] = 0.3 * Math.cos(i * 1.9);
    s.vel[i * 3 + 2] = 0.2 * Math.sin(i * 0.5);
  }
  return s;
}

describe("direct/'s jerk", () => {
  it("IS the time derivative of the acceleration, softening included", () => {
    /* THE CONTRACT TEST. The acceleration depends on position alone, and the positions move at
       v, so advancing x by +-v*h and central-differencing gives da/dt exactly — no separate
       integration, no accumulated error. Softening is deliberately LARGE (0.3 against
       separations of order 1) so that a missing or wrong eps in the jerk kernel, which carries
       it in an r^-5 term, cannot hide behind a small correction. */
    const n = 8;
    const s = scattered(n);
    const force = createDirectForce({ softening: 0.3, G });
    expect(supportsJerk(force)).toBe(true);

    const acc = new Float64Array(n * 3);
    const jerk = new Float64Array(n * 3);
    force.accelerationsAndJerk!(s.pos, s.vel, s.mass, acc, jerk, 0);

    const h = 1e-6;
    const shifted = new Float64Array(n * 3);
    const aPlus = new Float64Array(n * 3);
    const aMinus = new Float64Array(n * 3);
    for (let i = 0; i < n * 3; i++) shifted[i] = s.pos[i] + s.vel[i] * h;
    force.accelerations(shifted, s.mass, aPlus, 0);
    for (let i = 0; i < n * 3; i++) shifted[i] = s.pos[i] - s.vel[i] * h;
    force.accelerations(shifted, s.mass, aMinus, 0);

    for (let c = 0; c < n * 3; c++) {
      const numerical = (aPlus[c] - aMinus[c]) / (2 * h);
      // Central differences at h=1e-6 are good to ~1e-9 relative; 1e-6 is the threshold.
      expect(Math.abs(numerical - jerk[c])).toBeLessThan(1e-6 * (1 + Math.abs(jerk[c])));
    }
  });

  it("returns the SAME accelerations as the plain kernel", () => {
    /* The jerk pass computes acceleration on its way. If the two ever disagreed, the Hermite
       predictor and corrector would be stepping different physics — the same trap the
       force-gradient kernel is guarded against. */
    const n = 6;
    const s = scattered(n);
    const force = createDirectForce({ softening: 0.05, G });
    const plain = new Float64Array(n * 3);
    const both = new Float64Array(n * 3);
    const jerk = new Float64Array(n * 3);
    force.accelerations(s.pos, s.mass, plain, 0);
    force.accelerationsAndJerk!(s.pos, s.vel, s.mass, both, jerk, 0);
    for (let i = 0; i < n * 3; i++) expect(both[i]).toBe(plain[i]);
  });

  it("vanishes when every particle moves together, because no separation changes", () => {
    /* A uniformly translating cloud has a rigid geometry, so a is constant in time and the jerk
       must be identically zero. This catches a kernel that used the raw velocity rather than the
       RELATIVE velocity v_ij — the most natural slip in the formula, and one the finite-
       difference test above would also catch but far less legibly. */
    const n = 5;
    const s = scattered(n);
    for (let i = 0; i < n; i++) {
      s.vel[i * 3] = 0.7;
      s.vel[i * 3 + 1] = -0.2;
      s.vel[i * 3 + 2] = 0.4;
    }
    const force = createDirectForce({ softening: 0.1, G });
    const acc = new Float64Array(n * 3);
    const jerk = new Float64Array(n * 3);
    force.accelerationsAndJerk!(s.pos, s.vel, s.mass, acc, jerk, 0);
    for (let i = 0; i < n * 3; i++) expect(Math.abs(jerk[i])).toBeLessThan(1e-15);
  });
});

/** Peak |dE/E0| over four orbits at a given step density. */
function peakEnergyError(stepsPerPeriod: number, adaptive = false): number {
  const s = keplerPair();
  const force = createDirectForce({ softening: KEPLER.softening, G: KEPLER.G });
  const it = createHermite(s, force, { maxStep: KEPLER_PERIOD / stepsPerPeriod, adaptive });
  const e0 = it.energy().total;
  let worst = 0;
  const samples = stepsPerPeriod * 4;
  for (let i = 0; i < samples; i++) {
    it.step((4 * KEPLER_PERIOD) / samples);
    worst = Math.max(worst, Math.abs(it.energy().total - e0) / Math.abs(e0));
  }
  return worst;
}

describe("createHermite", () => {
  it("converges at FOURTH order", () => {
    /* Halve the step: a second-order scheme's error falls by 4, a fourth-order scheme's by 16,
       a sixth-order scheme's by 64.
     *
     * THE STEP DENSITIES ARE HIGH ON PURPOSE. Measured (full table in `hermite.ts`), this
     * scheme's ratio is still falling at 1024 steps/period — 24.3, 21.7, 19.5, 18.0, 17.1,
     * 17.3 over 256..8192 — so measuring at the coarse end reports a pre-asymptotic number
     * that is not the convergence order. Starting at 1024 gives 18.0 and 17.1.
     *
     * THE BOUND COMES FROM WHAT IT MUST DISCRIMINATE, NOT FROM THOSE NUMBERS. [10, 30] excludes
     * second order (4) and sixth (64) by wide margins while sitting ~1.7x either side of the
     * measured values. Bracketing the measurement tightly — the earlier draft used [11, 22]
     * against a measured 21.7 — would be fitting the bound to the observation, which makes the
     * test a record of one run rather than a statement about the scheme. */
    const ratios: number[] = [];
    let previous: number | null = null;
    for (const spp of [1024, 2048, 4096]) {
      const e = peakEnergyError(spp);
      if (previous !== null) ratios.push(previous / e);
      previous = e;
    }
    expect(ratios).toHaveLength(2);
    for (const r of ratios) {
      expect(r).toBeGreaterThan(10);
      expect(r).toBeLessThan(30);
    }
  });

  it("refuses a force model that cannot supply a jerk, loudly", () => {
    /* Same contract as FSI4's refusal. A silent fallback to leapfrog would let a caller believe
       it was running an adaptive fourth-order scheme and misread every result it produced. */
    const s = keplerPair();
    const meanField = createMeanFieldForce(s.n, { G: KEPLER.G, rMin: 1e-3, rMax: 100 });
    expect(supportsJerk(meanField)).toBe(false);
    expect(() => createHermite(s, meanField)).toThrow(/jerk/i);
  });

  it("advances time by exactly the requested amount, across sub-steps", () => {
    const s = keplerPair();
    const force = createDirectForce({ softening: KEPLER.softening, G: KEPLER.G });
    const it = createHermite(s, force, { maxStep: KEPLER_PERIOD / 64 });
    it.step(KEPLER_PERIOD);
    expect(it.t).toBeCloseTo(KEPLER_PERIOD, 9);
    it.step(KEPLER_PERIOD / 3);
    expect(it.t).toBeCloseTo(KEPLER_PERIOD * (4 / 3), 9);
  });

  it("advances time exactly in ADAPTIVE mode too, where sub-steps are unequal", () => {
    /* The adaptive path sizes its own sub-steps and must still land on the requested dt. This is
       where an off-by-one in the "truncate the last sub-step" logic would show, and it would
       show as a slow time drift rather than as a wrong answer — the kind of defect that survives
       a whole session because every individual frame looks fine. */
    const s = keplerPair();
    const force = createDirectForce({ softening: KEPLER.softening, G: KEPLER.G });
    const it = createHermite(s, force, { adaptive: true, maxStep: KEPLER_PERIOD / 64 });
    for (let i = 0; i < 8; i++) it.step(KEPLER_PERIOD / 8);
    expect(it.t).toBeCloseTo(KEPLER_PERIOD, 9);
  });

  it("SHRINKS its advised step near periapsis — the reason to port it at all", () => {
    /* THE PROPERTY THE WHOLE PORT EXISTS FOR. A fixed-step scheme spends the same effort at
       apoapsis, where nothing happens, as at periapsis, where the encounter is. The Aarseth
       criterion sizes the step from the force derivatives, so it must contract as the pair
       closes. At e = 0.5 the separation ranges 0.5..1.5 — a factor of 3 — and the encounter
       timescale scales as r^(3/2), so the advised step should fall by a factor of order 5.
       Asserted at >2 so this tests the SIGN and rough magnitude of the response rather than a
       fitted number. */
    const s = keplerPair();
    const force = createDirectForce({ softening: KEPLER.softening, G: KEPLER.G });
    const it = createHermite(s, force, { adaptive: true, maxStep: KEPLER_PERIOD / 64 });

    const atApoapsis = it.advisedStep();
    expect(keplerSeparation(s)).toBeCloseTo(KEPLER.a * (1 + KEPLER.eccentricity), 6);

    let smallest = Infinity;
    let tightest = Infinity;
    const samples = 256;
    for (let i = 0; i < samples; i++) {
      it.step(KEPLER_PERIOD / samples);
      smallest = Math.min(smallest, it.advisedStep());
      tightest = Math.min(tightest, keplerSeparation(s));
    }
    // The orbit really did reach periapsis, so the comparison is over the full range.
    expect(tightest).toBeLessThan(KEPLER.a * (1 - KEPLER.eccentricity) * 1.05);
    expect(atApoapsis / smallest).toBeGreaterThan(2);
  });

  it("reports an energy whose potential comes from the force model", () => {
    const s = keplerPair();
    const force = createDirectForce({ softening: KEPLER.softening, G: KEPLER.G });
    const it = createHermite(s, force);
    const e = it.energy();
    expect(e.potential).toBe(force.potentialEnergy(s.pos, s.mass, 0));
    expect(e.total).toBeCloseTo(e.kinetic + e.potential, 12);
    expect(e.total).toBeLessThan(0); // a bound orbit
  });
});

describe("chooseIntegrator with Hermite available", () => {
  it("still defaults to FSI4, because Hermite is an instrument and not the default", () => {
    /* Hermite is fourth order too, so "highest order wins" would pick either. It must not: FSI4
       is symplectic and ~50x more accurate at equal step, and a default that quietly acquired a
       secular energy error would undo the reason ADR 0016 chose a symplectic scheme. */
    const s = keplerPair();
    const picked = chooseIntegrator(s, createDirectForce({ softening: KEPLER.softening, G }));
    expect(picked.scheme).toBe("fsi4");
  });

  it("returns Hermite when asked for it by name", () => {
    const s = keplerPair();
    const picked = chooseIntegrator(s, createDirectForce({ softening: KEPLER.softening, G }), {
      prefer: "hermite",
    });
    expect(picked.scheme).toBe("hermite");
    expect(picked.order).toBe(4);
  });

  it("THROWS rather than substituting when the asked-for scheme is unavailable", () => {
    /* The load-bearing behaviour of `prefer`. A caller running a three-way comparison that
       silently received a leapfrog in the Hermite arm would publish a comparison of something
       else entirely, and every number in it would look reasonable. */
    const s = keplerPair();
    const meanField = createMeanFieldForce(s.n, { G, rMin: 1e-3, rMax: 100 });
    expect(() => chooseIntegrator(s, meanField, { prefer: "hermite" })).toThrow(/jerk/i);
    expect(() => chooseIntegrator(s, meanField, { prefer: "fsi4" })).toThrow(/forceGradient/);
  });

  it("reports what each model can actually run", () => {
    const s = keplerPair();
    /* `symmetric` sits between fsi4 and hermite: it needs the same jerk kernel hermite does,
       and where both run it is the better of the two — hermite is carried as its asymmetric
       control. Order is a quality statement; the DEFAULT is still fsi4, asserted below. */
    expect(availableSchemes(createDirectForce({ softening: KEPLER.softening, G }))).toEqual([
      "fsi4",
      "symmetric",
      "hermite",
      "leapfrog",
    ]);
    // meanField supplies neither capability: the leapfrog is its only option.
    expect(availableSchemes(createMeanFieldForce(s.n, { G, rMin: 1e-3, rMax: 100 }))).toEqual([
      "leapfrog",
    ]);
  });
});
