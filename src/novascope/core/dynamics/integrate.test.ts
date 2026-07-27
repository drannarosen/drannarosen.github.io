/*
 * integrate.test.ts — is the leapfrog actually symplectic and actually reversible?
 *
 * TESTED AGAINST A HARMONIC OSCILLATOR, DELIBERATELY, AND NOT AGAINST AN N-BODY FORCE.
 * The oscillator has an exact analytic solution, an exactly known energy, and no force code
 * of its own worth doubting — so a failure here is the INTEGRATOR's, which is the whole point
 * of separating it from `direct/` and `meanField/`. Those get their own tests, against Kepler
 * and against each other.
 *
 * The two properties that matter are both about what SYMPLECTIC means, and neither is
 * "energy is conserved", because leapfrog does not conserve energy exactly:
 *
 *   1. Time-reversibility, which is EXACT up to round-off and needs no reference solution.
 *   2. Bounded energy error with NO SECULAR TREND. A maximum-error test alone would pass for
 *      a non-symplectic scheme over a short run, which would make it decoration — so the
 *      assertion compares the error in the second half of the run against the first.
 */
import { describe, expect, it } from "vitest";
import { createLeapfrog } from "./integrate.ts";
import { createState, type ForceModel, type State, type Vec3Array } from "./types.ts";
import { createDirectForce } from "./direct/index.ts";
import { createMeanFieldForce } from "./meanField/index.ts";
import { mulberry32 } from "../random/index.ts";
import { removeBulkMotion, scaleToVirial } from "./ic.ts";

/**
 * A 3-D isotropic harmonic oscillator, a = -omega^2 x, with U = 1/2 m omega^2 r^2.
 *
 * U is the exact integral of the force, which is what `ForceModel` requires of a real model
 * too — so this helper exercises the contract rather than sidestepping it.
 */
function harmonic(omega: number): ForceModel {
  const w2 = omega * omega;
  return {
    id: "harmonic",
    accelerations(pos: Vec3Array, _mass: Float64Array, accOut: Vec3Array): void {
      for (let i = 0; i < pos.length; i++) accOut[i] = -w2 * pos[i];
    },
    potentialEnergy(pos: Vec3Array, mass: Float64Array): number {
      let u = 0;
      for (let i = 0; i < mass.length; i++) {
        const x = pos[i * 3];
        const y = pos[i * 3 + 1];
        const z = pos[i * 3 + 2];
        u += 0.5 * mass[i] * w2 * (x * x + y * y + z * z);
      }
      return u;
    },
    potentials(pos: Vec3Array, mass: Float64Array, out: Float64Array): void {
      // An external well, so no 1/2: Phi_i is the full potential each particle sits in.
      for (let i = 0; i < mass.length; i++) {
        const x = pos[i * 3];
        const y = pos[i * 3 + 1];
        const z = pos[i * 3 + 2];
        out[i] = 0.5 * w2 * (x * x + y * y + z * z);
      }
    },
  };
}

/** One unit-mass particle displaced along x with a transverse kick — a closed ellipse. */
function oneParticle(): State {
  const s = createState(1);
  s.mass[0] = 1;
  s.pos[0] = 1;
  s.vel[1] = 0.6;
  return s;
}

const OMEGA = 2 * Math.PI; // period 1.0, so "steps per period" reads directly

describe("createLeapfrog", () => {
  it("is exactly time-reversible: forward, flip velocities, forward again returns the start", () => {
    const s = oneParticle();
    const pos0 = Float64Array.from(s.pos);
    const vel0 = Float64Array.from(s.vel);

    const lf = createLeapfrog(s, harmonic(OMEGA));
    const h = 1 / 64;
    for (let i = 0; i < 512; i++) lf.step(h);

    /* No `invalidateAcceleration()` here, deliberately: the cache is keyed on POSITION, and
       flipping velocities does not change the force. If this ever needs invalidating, the
       cache has grown a dependency it should not have. */
    for (let i = 0; i < s.vel.length; i++) s.vel[i] = -s.vel[i];
    for (let i = 0; i < 512; i++) lf.step(h);

    /* Round-off only, and the bound is a "nothing systematic happened" threshold rather than
       a fit: measured 2026-07-26, 8.9e-16 in position and 7.2e-15 in velocity over 1024
       steps — five orders of magnitude of headroom. Anything approaching 1e-10 would mean
       the scheme had stopped being reversible, not that round-off had grown. */
    for (let i = 0; i < pos0.length; i++) {
      expect(Math.abs(s.pos[i] - pos0[i])).toBeLessThan(1e-10);
      expect(Math.abs(-s.vel[i] - vel0[i])).toBeLessThan(1e-10);
    }
  });

  it("keeps the energy error BOUNDED — the second half is no worse than the first", () => {
    const s = oneParticle();
    const lf = createLeapfrog(s, harmonic(OMEGA));
    const h = 1 / 64;
    const periods = 400;
    const steps = periods * 64;

    const e0 = lf.energy().total;
    let firstHalf = 0;
    let secondHalf = 0;
    for (let i = 0; i < steps; i++) {
      lf.step(h);
      const rel = Math.abs(lf.energy().total - e0) / Math.abs(e0);
      if (i < steps / 2) firstHalf = Math.max(firstHalf, rel);
      else secondHalf = Math.max(secondHalf, rel);
    }

    /* Bounded. For a harmonic oscillator the leapfrog's relative energy amplitude is
       (omega*h)^2/4 = 2.41e-3 at omega*h = 0.0982, and it measures 2.366e-3 — so the bound
       is set from the analytic scaling with ~4x headroom, not from the measurement. */
    expect(secondHalf).toBeLessThan(1e-2);
    /* NOT SECULAR — the real assertion. A drifting integrator's error grows with time, so its
       second half is strictly worse. Equal halves is what symplectic buys, and it is equal to
       six decimal places: measured ratio 1.000000 over 400 periods. 1.5 is a threshold. */
    expect(secondHalf / firstHalf).toBeLessThan(1.5);
  });

  it("TEETH: forward Euler fails the secular test the leapfrog passes", () => {
    /* A gate never seen to fail is decoration. Euler on an oscillator gains energy every
       step, so its second half is dramatically worse — which is exactly what the assertion
       above is written to detect. If this test ever passes with a small ratio, the energy
       test above has stopped discriminating and must be repaired, not relaxed. */
    const s = oneParticle();
    const force = harmonic(OMEGA);
    const acc = new Float64Array(3);
    const h = 1 / 64;
    const steps = 400 * 64;

    const energyOf = (): number => {
      let k = 0;
      for (let i = 0; i < 3; i++) k += 0.5 * s.mass[0] * s.vel[i] * s.vel[i];
      return k + force.potentialEnergy(s.pos, s.mass, 0);
    };

    const e0 = energyOf();
    let firstHalf = 0;
    let secondHalf = 0;
    for (let i = 0; i < steps; i++) {
      force.accelerations(s.pos, s.mass, acc, 0);
      for (let j = 0; j < 3; j++) {
        s.pos[j] += s.vel[j] * h; // explicit Euler: both updates use the OLD state
        s.vel[j] += acc[j] * h;
      }
      const rel = Math.abs(energyOf() - e0) / Math.abs(e0);
      if (i < steps / 2) firstHalf = Math.max(firstHalf, rel);
      else secondHalf = Math.max(secondHalf, rel);
    }

    /* Measured 2026-07-26: 2.1e53. The threshold is 10 because any secular growth at all
       falsifies "bounded"; the margin here is 52 orders of magnitude, so this is not a
       delicate discrimination. */
    expect(secondHalf / firstHalf).toBeGreaterThan(10);
  });

  it("reports an energy whose potential comes from the force model, not from a second copy", () => {
    const s = oneParticle();
    const force = harmonic(OMEGA);
    const lf = createLeapfrog(s, force);
    const e = lf.energy();
    expect(e.potential).toBe(force.potentialEnergy(s.pos, s.mass, 0));
    expect(e.total).toBeCloseTo(e.kinetic + e.potential, 12);
    // 1/2 m (v^2) with v = 0.6 => 0.18; U = 1/2 omega^2 x^2 with x = 1.
    expect(e.kinetic).toBeCloseTo(0.18, 12);
    expect(e.potential).toBeCloseTo(0.5 * OMEGA * OMEGA, 12);
  });

  it("advances time by exactly the requested amount", () => {
    const lf = createLeapfrog(oneParticle(), harmonic(OMEGA));
    lf.step(0.25);
    lf.step(0.25);
    expect(lf.t).toBeCloseTo(0.5, 12);
  });
});

describe("the ForceModel seam", () => {
  /* The whole reason `direct/` and `meanField/` are separate modules behind one interface is
     that the integrator can step either without knowing which. Nothing asserted that, so the
     seam was a claim rather than a tested property (2026-07-26 review, P3). */
  /* VIRIALIZED before stepping, and that is not a convenience.
   *
   * An arbitrary velocity draw is deeply sub-virial, and a sub-virial cluster collapses —
   * which `../gasExpulsion/`'s header names as "exactly the regime this solver cannot
   * conserve energy through". An earlier draft of this test skipped the scaling and watched
   * meanField's energy move by 238%, which is the documented behaviour of a binned profile
   * changing faster than its grid resolves, not a bug in the seam. `direct` survives the same
   * setup because its force IS the gradient of its potential; meanField's is not.
   *
   * So the fix was to build the initial conditions the way a real caller does, rather than to
   * loosen the bound until the pathological case fitted under it. */
  const cluster = (force: ForceModel): State => {
    const rng = mulberry32(31415);
    const s = createState(400);
    for (let i = 0; i < s.n; i++) {
      s.mass[i] = 0.5 + rng();
      const u = Math.max(rng(), 1e-4);
      const r = 1 / Math.sqrt(u ** (-2 / 3) - 1);
      const cosT = 2 * rng() - 1;
      const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
      const phi = 2 * Math.PI * rng();
      s.pos[i * 3] = r * sinT * Math.cos(phi);
      s.pos[i * 3 + 1] = r * sinT * Math.sin(phi);
      s.pos[i * 3 + 2] = r * cosT;
      for (let k = 0; k < 3; k++) s.vel[i * 3 + k] = rng() - 0.5;
    }
    removeBulkMotion(s);
    scaleToVirial(s, force, 0.5);
    return s;
  };

  const models = [
    { id: "direct", make: () => createDirectForce({ softening: 0.05, G: 1 }) },
    { id: "meanField", make: () => createMeanFieldForce(400, { G: 1, rMin: 1e-3, rMax: 100 }) },
  ];

  for (const { id, make } of models) {
    it(`steps '${id}' through the same integrator with no special-casing`, () => {
      const force = make();
      const s = cluster(force);
      expect(force.id).toBe(id);

      /* maxStep is t_cross/200, the sub-step density gasExpulsion measured as its accuracy
         plateau. t_cross ~ 2 r_h / sqrt(G M / r_h) ~ 0.15 here. */
      const lf = createLeapfrog(s, force, { maxStep: 0.15 / 200 });
      const e0 = lf.energy();
      expect(Number.isFinite(e0.total)).toBe(true);
      expect(e0.potential).toBeLessThan(0); // gravity is attractive, in both models

      for (let i = 0; i < 200; i++) lf.step(0.15 / 200);
      const e1 = lf.energy();
      expect(Number.isFinite(e1.total)).toBe(true);
      /* A loose bound on purpose. meanField's force is NOT the gradient of its potential
         (binned M(<r) is a step function), so it carries a spatial-discretization drift that
         no timestep removes — this asserts the run stays physical, not that both conserve
         equally. The tight conservation claims live in each model's own test file. */
      expect(Math.abs(e1.total - e0.total) / Math.abs(e0.total)).toBeLessThan(0.2);

      // Every particle still has a finite position: neither model has blown up.
      for (let i = 0; i < s.pos.length; i++) expect(Number.isFinite(s.pos[i])).toBe(true);
    });

    it(`'${id}' satisfies the potentials/potentialEnergy relationship the interface requires`, () => {
      const force = make();
      const s = cluster(force);
      const phi = new Float64Array(s.n);
      force.potentials(s.pos, s.mass, phi, 0);
      let half = 0;
      for (let i = 0; i < s.n; i++) half += 0.5 * s.mass[i] * phi[i];
      // U = 1/2 sum m_i Phi_i for a self-gravitating system, in BOTH models.
      expect(half).toBeCloseTo(force.potentialEnergy(s.pos, s.mass, 0), 8);
    });
  }
});
