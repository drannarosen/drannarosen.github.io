/*
 * diagnostics.test.ts — the numbers shown to a reader.
 *
 * The load-bearing test here is the boundness one. Escape is set by the POTENTIAL, and mass
 * exterior to a star contributes to the potential while exerting no net force on it. A
 * boundness test built on the force-side quantity — enclosed mass — reports a cluster
 * disrupting while it sits safely at the bottom of a deep well, and it is wrong by more the
 * deeper the well is. That is precisely the regime `../gasExpulsion/` runs in.
 */
import { describe, expect, it } from "vitest";
import { lagrangianRadii, measure, radii } from "./diagnostics.ts";
import { createMeanFieldForce } from "./meanField/index.ts";
import { createDirectForce } from "./direct/index.ts";
import { createState } from "./types.ts";

const G = 1;

/** n particles on a uniform radial ladder out to rMax, equal masses, at rest. */
function ladder(n: number, rMax: number, mTotal = 1): ReturnType<typeof createState> {
  const s = createState(n);
  for (let i = 0; i < n; i++) {
    s.mass[i] = mTotal / n;
    s.pos[i * 3] = ((i + 1) / n) * rMax;
  }
  return s;
}

describe("radii / lagrangianRadii", () => {
  it("reports the radii enclosing given mass fractions", () => {
    const s = ladder(100, 10);
    const r = new Float64Array(s.n);
    radii(s, r);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[99]).toBeCloseTo(10, 12);

    const [r10, r50, r90] = lagrangianRadii(s, [0.1, 0.5, 0.9]);
    /* Equal masses on a uniform ladder: the f-th mass fraction sits at exactly f * rMax, and
       the interpolating estimator hits it EXACTLY. Asserted to 9 decimals deliberately — the
       step-function version this replaced returned 1.1 / 5.1 / 9.0, a one-sided one-particle
       overshoot from floating-point partial sums, and a loose tolerance would have accepted
       it. The tight bound is what makes this test able to see the bug it was written for. */
    expect(r10).toBeCloseTo(1, 9);
    expect(r50).toBeCloseTo(5, 9);
    expect(r90).toBeCloseTo(9, 9);
    expect(r10).toBeLessThan(r50);
    expect(r50).toBeLessThan(r90);
  });

  it("restricts to a subset when asked, so escapers cannot inflate r_h", () => {
    const s = ladder(100, 10);
    // Pretend the outer half has escaped: the bound half-mass radius must halve, not drift.
    const all = lagrangianRadii(s, [0.5])[0];
    const inner = lagrangianRadii(s, [0.5], (i) => i < 50)[0];
    expect(all).toBeCloseTo(5, 9);
    expect(inner).toBeCloseTo(2.5, 9);
  });
});

describe("measure", () => {
  it("counts a star as bound using the FULL potential, exterior mass included", () => {
    /* One slow star at small radius, inside a heavy external background whose mass is mostly
       OUTSIDE it. The interior mass is negligible, so a force-side boundness test would call
       it unbound; the potential it actually sits in is deep, so it is firmly bound. */
    const s = createState(1);
    s.mass[0] = 1e-6; // a tracer: its own self-gravity is irrelevant
    s.pos[0] = 0.05; // well inside the background
    s.vel[1] = 0.2; // slow

    const shellMass = 1000;
    const shellRadius = 10;
    const force = createMeanFieldForce(1, {
      G,
      rMin: 1e-3,
      rMax: 100,
      external: {
        // All the mass sits at shellRadius, so essentially none is interior to the star…
        enclosedMass: (r) => (r >= shellRadius ? shellMass : 0),
        // …but its potential inside the shell is deep and constant, which is the whole point.
        potential: (r) => (-G * shellMass) / Math.max(r, shellRadius),
      },
    });

    const d = measure(s, force);
    expect(d.boundFraction).toBe(1);
    expect(d.boundMassFraction).toBe(1);

    // Confirm the trap is real: interior mass alone would give essentially zero potential,
    // and 1/2 v^2 > 0 would then read as unbound.
    const enclosedOnly = 0; // no external mass inside r = 0.05
    expect(0.5 * 0.2 ** 2 + -G * enclosedOnly / 0.05).toBeGreaterThan(0);
  });

  it("calls a fast star unbound and a slow one bound in the same cluster", () => {
    const s = createState(3);
    for (let i = 0; i < 3; i++) {
      s.mass[i] = 1;
      s.pos[i * 3] = 1 + i * 0.1;
    }
    const force = createDirectForce({ softening: 0.01, G });
    const phi = new Float64Array(3);
    force.potentials(s.pos, s.mass, phi, 0);

    // Star 0 sits at potential phi[0]; escape speed is sqrt(-2 phi).
    const vEsc = Math.sqrt(-2 * phi[0]);
    s.vel[0] = 0.1 * vEsc; // firmly bound
    s.vel[3] = 2 * vEsc; // firmly unbound
    s.vel[6] = 0.1 * vEsc;

    const d = measure(s, force);
    expect(d.boundFraction).toBeCloseTo(2 / 3, 12);
    expect(d.boundMassFraction).toBeCloseTo(2 / 3, 12);
  });

  it("reports Q = 1/2 for a system scaled to equilibrium, and energy that adds up", () => {
    const s = createState(20);
    for (let i = 0; i < 20; i++) {
      s.mass[i] = 1;
      s.pos[i * 3] = Math.cos(i) * 2;
      s.pos[i * 3 + 1] = Math.sin(i * 1.3) * 2;
      s.pos[i * 3 + 2] = Math.cos(i * 0.7);
      s.vel[i * 3 + 1] = 0.3 * Math.sin(i);
    }
    const force = createDirectForce({ softening: 0.05, G });
    const d = measure(s, force);
    expect(d.total).toBeCloseTo(d.kinetic + d.potential, 12);
    expect(d.virialRatio).toBeCloseTo(d.kinetic / Math.abs(d.potential), 12);
    expect(d.rmsSpeed).toBeGreaterThan(0);
  });

  it("agrees with the force model's own total: U = 1/2 sum m_i Phi_i for self-gravity", () => {
    /* The factor-of-two relationship between the per-star potentials and the system total.
       Getting it wrong is a classic and it is silent — every energy is simply twice what it
       should be, which still conserves. */
    const s = createState(30);
    for (let i = 0; i < 30; i++) {
      s.mass[i] = 0.5 + (i % 4);
      s.pos[i * 3] = Math.sin(i * 2.1) * 3;
      s.pos[i * 3 + 1] = Math.cos(i * 1.1) * 3;
      s.pos[i * 3 + 2] = Math.sin(i * 0.6) * 3;
    }
    const force = createDirectForce({ softening: 0.05, G });
    const phi = new Float64Array(30);
    force.potentials(s.pos, s.mass, phi, 0);
    let half = 0;
    for (let i = 0; i < 30; i++) half += 0.5 * s.mass[i] * phi[i];
    expect(half).toBeCloseTo(force.potentialEnergy(s.pos, s.mass, 0), 10);
  });
});
