/*
 * direct.test.ts — is the pairwise force actually the gradient of the pairwise potential,
 * and does it actually reproduce Kepler?
 *
 * The gradient test is the important one and it exists because of a specific trap
 * (`../types.ts`): a softened force paired with an unsoftened potential produces an energy
 * that drifts while the integrator is perfect, which reads as a broken symplectic scheme.
 * Checking the algebra by eye is exactly how that ships. So it is differentiated numerically.
 *
 * Kepler is the external reference — an analytic solution this model must reproduce, in the
 * regime where softening is negligible, with the softening's residual effect DERIVED rather
 * than tuned away.
 */
import { describe, expect, it } from "vitest";
import { createDirectForce, softeningForCluster } from "./index.ts";
import { createLeapfrog } from "../integrate.ts";
import { createState } from "../types.ts";
import { angularMomentum, momentum } from "../quantities.ts";

const G = 1; // test units: G = 1 keeps the analytic algebra readable.

describe("createDirectForce", () => {
  it("has accelerations that ARE the gradient of its potential, softening included", () => {
    /* THE CONTRACT TEST. dU/dx_i = -m_i a_i,x, verified by central differences on a random
       but fixed configuration with a deliberately LARGE softening (0.3 against separations
       of order 1) so that a wrong or missing eps in either half cannot hide. */
    const n = 6;
    const s = createState(n);
    const rnd = [
      0.31, -0.72, 0.55, -0.18, 0.94, -0.41, 0.67, 0.12, -0.86, -0.53, -0.29, 0.78, 0.05,
      0.61, -0.34, 0.88, -0.47, 0.23,
    ];
    for (let i = 0; i < n; i++) {
      s.mass[i] = 0.5 + 0.3 * i;
      for (let k = 0; k < 3; k++) s.pos[i * 3 + k] = rnd[i * 3 + k];
    }
    const force = createDirectForce({ softening: 0.3, G });
    const acc = new Float64Array(n * 3);
    force.accelerations(s.pos, s.mass, acc, 0);

    const h = 1e-6;
    for (let c = 0; c < n * 3; c++) {
      const saved = s.pos[c];
      s.pos[c] = saved + h;
      const uPlus = force.potentialEnergy(s.pos, s.mass, 0);
      s.pos[c] = saved - h;
      const uMinus = force.potentialEnergy(s.pos, s.mass, 0);
      s.pos[c] = saved;

      const numerical = (uPlus - uMinus) / (2 * h); // dU/dx_c
      const analytic = -s.mass[Math.floor(c / 3)] * acc[c]; // -m a
      // Central differences at h=1e-6 are good to ~1e-9 relative; 1e-6 is the threshold.
      expect(Math.abs(numerical - analytic)).toBeLessThan(1e-6 * (1 + Math.abs(analytic)));
    }
  });

  it("stays the gradient of its potential with PER-PARTICLE softening, including zeros", () => {
    /* The same contract as above, on the option that could break it. Per-particle eps combines
       as eps_ij^2 = eps_i eps_j across five separate kernels, so the failure mode is one kernel
       disagreeing with another — invisible in any single output, and fatal to the energy
       readout that judges every run on /dynamics-lab.
       Deliberately mixed, INCLUDING EXACT ZEROS, because a zero makes eps_ij vanish for every
       pair that particle is in: that is the "binary at eps = 0 inside a softened cluster" case,
       and it is the one where a stray `+ eps2` in one kernel would survive unnoticed. */
    const n = 6;
    const s = createState(n);
    const rnd = [
      0.31, -0.72, 0.55, -0.18, 0.94, -0.41, 0.67, 0.12, -0.86, -0.53, -0.29, 0.78, 0.05,
      0.61, -0.34, 0.88, -0.47, 0.23,
    ];
    const eps = Float64Array.from([0, 0, 0.4, 0.15, 0.25, 0.05]);
    for (let i = 0; i < n; i++) {
      s.mass[i] = 0.5 + 0.3 * i;
      for (let k = 0; k < 3; k++) s.pos[i * 3 + k] = rnd[i * 3 + k];
    }
    const force = createDirectForce({ softening: eps, G });
    const acc = new Float64Array(n * 3);
    force.accelerations(s.pos, s.mass, acc, 0);

    const h = 1e-6;
    for (let c = 0; c < n * 3; c++) {
      const saved = s.pos[c];
      s.pos[c] = saved + h;
      const uPlus = force.potentialEnergy(s.pos, s.mass, 0);
      s.pos[c] = saved - h;
      const uMinus = force.potentialEnergy(s.pos, s.mass, 0);
      s.pos[c] = saved;
      const numerical = (uPlus - uMinus) / (2 * h);
      const analytic = -s.mass[Math.floor(c / 3)] * acc[c];
      expect(Math.abs(numerical - analytic)).toBeLessThan(1e-6 * (1 + Math.abs(analytic)));
    }

    // And the per-star potential must still sum to the total: U = 1/2 sum m_i Phi_i.
    const phi = new Float64Array(n);
    force.potentials(s.pos, s.mass, phi, 0);
    let half = 0;
    for (let i = 0; i < n; i++) half += 0.5 * s.mass[i] * phi[i];
    expect(half).toBeCloseTo(force.potentialEnergy(s.pos, s.mass, 0), 10);
  });

  it("a uniform per-particle array is bit-identical to the equivalent scalar", () => {
    /* The two code paths must not be two physics. A scalar eps and an array of that same eps
       are the same model, so any difference is a defect in one of the branches — and this is
       the cheapest possible way to catch a kernel that was missed during the edit. */
    const n = 8;
    const s = createState(n);
    for (let i = 0; i < n; i++) {
      s.mass[i] = 1 + 0.1 * i;
      s.pos[i * 3] = Math.cos(i) * (1 + i * 0.1);
      s.pos[i * 3 + 1] = Math.sin(i) * (1 + i * 0.1);
      s.pos[i * 3 + 2] = 0.1 * i - 0.4;
      s.vel[i * 3 + 1] = 0.2 * Math.cos(i * 1.7);
      s.vel[i * 3] = 0.2 * Math.sin(i * 1.3);
    }
    const EPS = 0.17;
    const scalar = createDirectForce({ softening: EPS, G });
    const array = createDirectForce({ softening: new Float64Array(n).fill(EPS), G });

    const cmp = (a: Float64Array, b: Float64Array): void => {
      for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
    };
    const a1 = new Float64Array(n * 3);
    const a2 = new Float64Array(n * 3);
    scalar.accelerations(s.pos, s.mass, a1, 0);
    array.accelerations(s.pos, s.mass, a2, 0);
    cmp(a1, a2);

    expect(array.potentialEnergy(s.pos, s.mass, 0)).toBe(
      scalar.potentialEnergy(s.pos, s.mass, 0),
    );

    const p1 = new Float64Array(n);
    const p2 = new Float64Array(n);
    scalar.potentials(s.pos, s.mass, p1, 0);
    array.potentials(s.pos, s.mass, p2, 0);
    cmp(p1, p2);

    const g1 = new Float64Array(n * 3);
    const g2 = new Float64Array(n * 3);
    scalar.forceGradient!(s.pos, s.mass, a1, g1, 0);
    array.forceGradient!(s.pos, s.mass, a2, g2, 0);
    cmp(g1, g2);

    const j1 = new Float64Array(n * 3);
    const j2 = new Float64Array(n * 3);
    scalar.accelerationsAndJerk!(s.pos, s.vel, s.mass, a1, j1, 0);
    array.accelerationsAndJerk!(s.pos, s.vel, s.mass, a2, j2, 0);
    cmp(a1, a2);
    cmp(j1, j2);
  });

  it("conserves total momentum to round-off, because pairs are applied to both members", () => {
    const n = 20;
    const s = createState(n);
    for (let i = 0; i < n; i++) {
      s.mass[i] = 1 + (i % 5);
      s.pos[i * 3] = Math.cos(i) * (1 + (i % 3));
      s.pos[i * 3 + 1] = Math.sin(i * 1.7) * 2;
      s.pos[i * 3 + 2] = Math.cos(i * 2.3);
      s.vel[i * 3] = 0.1 * Math.sin(i);
      s.vel[i * 3 + 1] = 0.1 * Math.cos(i * 0.7);
    }
    const lf = createLeapfrog(s, createDirectForce({ softening: 0.05, G }), { maxStep: 0.01 });
    const p0 = momentum(s);
    for (let i = 0; i < 200; i++) lf.step(0.01);
    const p1 = momentum(s);
    // Round-off only: the pair loop makes sum(m a) identically zero, not approximately zero.
    for (let k = 0; k < 3; k++) expect(Math.abs(p1[k] - p0[k])).toBeLessThan(1e-10);
  });

  it("conserves total angular momentum, because pairwise forces are central", () => {
    const n = 12;
    const s = createState(n);
    for (let i = 0; i < n; i++) {
      s.mass[i] = 1;
      s.pos[i * 3] = Math.cos((i / n) * 2 * Math.PI) * 2;
      s.pos[i * 3 + 1] = Math.sin((i / n) * 2 * Math.PI) * 2;
      s.pos[i * 3 + 2] = 0.1 * Math.sin(i);
      s.vel[i * 3] = -Math.sin((i / n) * 2 * Math.PI) * 0.5;
      s.vel[i * 3 + 1] = Math.cos((i / n) * 2 * Math.PI) * 0.5;
    }
    const lf = createLeapfrog(s, createDirectForce({ softening: 0.05, G }), { maxStep: 0.005 });
    const l0 = angularMomentum(s);
    for (let i = 0; i < 400; i++) lf.step(0.005);
    const l1 = angularMomentum(s);
    const mag = Math.hypot(...l0);
    for (let k = 0; k < 3; k++) expect(Math.abs(l1[k] - l0[k])).toBeLessThan(1e-9 * (1 + mag));
  });

  it("reproduces a Kepler circular orbit, to the accuracy the softening allows", () => {
    /* Two equal masses on a circular orbit about their common centre of mass.
     *
     *   separation a, each at a/2 from the COM
     *   attraction G m^2 / a^2 = m v^2 / (a/2)  =>  v = sqrt(G m / (2a))
     *   period     T = 2 pi (a/2) / v
     *
     * Velocities are set from the UNSOFTENED law, so this asks whether our force IS Kepler.
     * It is not exactly: Plummer softening weakens it by (1 + eps^2/a^2)^(-3/2), which at
     * eps/a = 1e-3 is a deficit of 1.5e-6. The bound below comes from THAT number, not from
     * running the test and seeing what came out.
     */
    const m = 1;
    const a = 1;
    const eps = 1e-3 * a;
    const v = Math.sqrt((G * m) / (2 * a));
    const T = (2 * Math.PI * (a / 2)) / v;

    const s = createState(2);
    s.mass[0] = m;
    s.mass[1] = m;
    s.pos[0] = -a / 2;
    s.pos[3] = a / 2;
    s.vel[1] = -v;
    s.vel[4] = v;

    const lf = createLeapfrog(s, createDirectForce({ softening: eps, G }), { maxStep: T / 2048 });

    /* Sample the separation THROUGHOUT rather than at the end. Checking only the endpoint
       cannot detect eccentricity at all — an elliptical orbit returns to its starting radius
       after one period, which is exactly when the endpoint is measured. An earlier draft of
       this test made that mistake while its comment claimed otherwise. */
    let worstSep = 0;
    const samples = 64;
    for (let i = 0; i < samples; i++) {
      lf.step(T / samples);
      const sep = Math.hypot(s.pos[3] - s.pos[0], s.pos[4] - s.pos[1], s.pos[5] - s.pos[2]);
      worstSep = Math.max(worstSep, Math.abs(sep - a));
    }

    /* THE POSITION BOUND, derived. Softening weakens the force by (1+eps^2/a^2)^(-3/2), a
       deficit of delta = 1.5e-6 at eps/a = 1e-3. A weaker force means a longer period, so
       after one KEPLER period the body sits slightly behind: the phase lag is ~2pi(3/2)delta
       ~ 1.4e-5, almost entirely tangential. Measured 1.93e-5 tangential and 3.7e-10 radial,
       so the bound below is ~5x headroom over a predicted effect — not 65x, which is what
       comparing it against the force deficit instead of the resulting displacement gave. */
    expect(Math.abs(s.pos[0] - -a / 2)).toBeLessThan(1e-4);
    expect(Math.abs(s.pos[1])).toBeLessThan(1e-4);
    expect(Math.abs(s.pos[3] - a / 2)).toBeLessThan(1e-4);
    expect(Math.abs(s.pos[4])).toBeLessThan(1e-4);

    /* THE SHAPE BOUND. Measured worst deviation 7.71e-6 over 64 samples, and two known
       effects of that order account for it: the unsoftened velocity is slightly too fast for
       the softened force, giving eccentricity e ~ delta = 1.5e-6 and a radial excursion
       ~2ea = 3e-6; and the leapfrog's own radial error at omega*h = 2pi/2048 is
       (omega h)^2/4 = 2.4e-6. Bound at 1e-4, ~13x above the measurement, on effects that are
       both derived rather than observed after the fact. */
    expect(worstSep).toBeLessThan(1e-4);
  });

  it("softeningForCluster scales as r_h N^(-1/3), at the COLLISIONAL fraction", () => {
    /* Default 0.5 rather than 1: eps ~ the mean separation is the collisionless convention,
       whose purpose is suppressing the two-body relaxation this model exists to produce. */
    expect(softeningForCluster(1, 1000)).toBeCloseTo(0.05, 12);
    expect(softeningForCluster(1, 1000, 1)).toBeCloseTo(0.1, 12);
    expect(softeningForCluster(2, 8, 1)).toBeCloseTo(1, 12);
  });
});
