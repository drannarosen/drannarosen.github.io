/*
 * The claims this scheme makes, in the order the validation hierarchy asks for them:
 * the density against its analytic value, then the property the whole design rests on
 * (time-reversibility of the AUGMENTED map), then that it actually adapts, then that the
 * error does not go secular the way a naive controller's does.
 */
import { describe, expect, it } from "vitest";
import {
  createReversibleAdaptive,
  pairFrequencyDensity,
  DEFAULT_ETA,
} from "./reversibleAdaptive.ts";
import { createDirectForce } from "./direct/index.ts";
import { G_PC3_MSUN_MYR2 as G } from "../constants/index.ts";
import type { State } from "./types.ts";

/** Two bodies on a circular orbit about their barycentre, separation `r`. */
function twoBody(m1: number, m2: number, r: number, ecc = 0): State {
  const M = m1 + m2;
  /* Vis-viva at apoapsis of an orbit with semi-major axis a = r/(1+e). */
  const a = r / (1 + ecc);
  const vRel = Math.sqrt(G * M * (2 / r - 1 / a));
  const f1 = m2 / M;
  const f2 = m1 / M;
  return {
    n: 2,
    mass: Float64Array.from([m1, m2]),
    pos: Float64Array.from([r * f1, 0, 0, -r * f2, 0, 0]),
    vel: Float64Array.from([0, vRel * f1, 0, 0, -vRel * f2, 0]),
  };
}

describe("pairFrequencyDensity — against the analytic pair frequency", () => {
  it("returns the pair's own orbital frequency when one pair dominates", () => {
    const m1 = 30;
    const m2 = 20;
    const r = 0.02;
    const s = twoBody(m1, m2, r);
    const omega = Math.sqrt((G * (m1 + m2)) / r ** 3);
    const d = pairFrequencyDensity(s, { dtMax: 1, eta: DEFAULT_ETA });
    /* p = 8 with a single pair and a far-below cap: Q is that pair's omega to round-off. */
    expect(d.value).toBeCloseTo(omega, 10);
    expect(d.timestep).toBeCloseTo(DEFAULT_ETA / omega, 12);
    expect(d.valid).toBe(true);
  });

  it("d ln Q/dt is -1.5 (r.v)/r^2 for a single dominant pair", () => {
    /* Radial approach, so the rate is unambiguous and nonzero. */
    const s: State = {
      n: 2,
      mass: Float64Array.from([10, 10]),
      pos: Float64Array.from([0.05, 0, 0, -0.05, 0, 0]),
      vel: Float64Array.from([-3, 0, 0, 3, 0, 0]),
    };
    const dx = 0.1;
    const dvx = -6;
    const expected = -1.5 * ((dx * dvx) / dx ** 2);
    const d = pairFrequencyDensity(s, { dtMax: 1 });
    expect(d.logarithmicRate).toBeCloseTo(expected, 9);
    /* Approaching => Q rising => positive rate. */
    expect(d.logarithmicRate).toBeGreaterThan(0);
  });

  it("the rate FLIPS SIGN under velocity reversal — the reversibility hinge", () => {
    const s = twoBody(30, 20, 0.02, 0.7);
    const forward = pairFrequencyDensity(s, { dtMax: 1 }).logarithmicRate;
    for (let i = 0; i < s.vel.length; i++) s.vel[i] = -s.vel[i]!;
    const back = pairFrequencyDensity(s, { dtMax: 1 }).logarithmicRate;
    expect(back).toBeCloseTo(-forward, 12);
  });

  it("a tighter pair gives a higher Q and a shorter step", () => {
    const wide = pairFrequencyDensity(twoBody(30, 20, 0.1), { dtMax: 1 });
    const tight = pairFrequencyDensity(twoBody(30, 20, 0.01), { dtMax: 1 });
    /* omega goes as r^(-3/2), so a tenth the separation is 10^1.5 = 31.6x the frequency. */
    expect(tight.value / wide.value).toBeCloseTo(10 ** 1.5, 6);
    expect(tight.timestep).toBeLessThan(wide.timestep);
  });

  it("the dtMax cap floors Q, so an empty-ish configuration cannot ask for a huge step", () => {
    /* Two distant, light stars: their own frequency is tiny, so the cap must dominate. */
    const s = twoBody(1e-6, 1e-6, 50);
    const dtMax = 0.01;
    const d = pairFrequencyDensity(s, { dtMax, eta: DEFAULT_ETA });
    expect(d.timestep).toBeLessThanOrEqual(dtMax * (1 + 1e-9));
    expect(d.value).toBeCloseTo(DEFAULT_ETA / dtMax, 6);
  });

  it("is a MAX not a SUM: adding distant pairs barely moves it", () => {
    /* This is the whole difference from LogH, so it is asserted rather than described. */
    const tight = twoBody(30, 20, 0.01);
    const many: State = {
      n: 12,
      mass: new Float64Array(12).fill(10),
      pos: new Float64Array(36),
      vel: new Float64Array(36),
    };
    many.mass[0] = 30;
    many.mass[1] = 20;
    many.pos.set(tight.pos.subarray(0, 6));
    many.vel.set(tight.vel.subarray(0, 6));
    for (let i = 2; i < 12; i++) many.pos[i * 3] = 5 + i; // strung out far away
    const alone = pairFrequencyDensity(tight, { dtMax: 1 }).value;
    const crowd = pairFrequencyDensity(many, { dtMax: 1 }).value;
    expect(crowd / alone).toBeGreaterThan(0.999);
    expect(crowd / alone).toBeLessThan(1.001);
  });

  it("stays finite at separations where omega^8 would overflow a double", () => {
    /* omega^8 at r = 1e-4 pc is ~1e44 before the log-sum-exp shift; the point of the shift. */
    const d = pairFrequencyDensity(twoBody(40, 40, 1e-4), { dtMax: 1 });
    expect(Number.isFinite(d.value)).toBe(true);
    expect(d.valid).toBe(true);
    expect(d.value).toBeCloseTo(Math.sqrt((G * 80) / 1e-4 ** 3), 0);
  });
});

describe("createReversibleAdaptive — the augmented map is time-reversible", () => {
  it("N steps forward, flip velocities CARRYING rho, N steps back — to machine precision", () => {
    /*
     * THE PROPERTY THE WHOLE SCHEME RESTS ON, and two things about how it must be tested.
     *
     * rho IS PART OF THE STATE. Reversibility is a statement about (q, p, rho) -> (q', p', rho'),
     * so the reverse leg carries rho rather than re-seeding it from the flipped state. Re-seeding
     * is exactly the irreversible controller this file replaces.
     *
     * AND IT IS AN EQUAL NUMBER OF STEPS, not an equal elapsed time. `step(dt)` overshoots — it
     * takes whole controller steps until it passes dt — so a test written against it measures
     * that overshoot: the two legs take different step counts and the round trip comes back
     * 1e-6 off. Stepping N and N reverses the actual map and returns to 5e-17, which is what
     * "reversible" is supposed to mean and is nine orders tighter than the loose version.
     */
    const s = twoBody(30, 20, 0.05, 0.6);
    const pos0 = Float64Array.from(s.pos);
    const vel0 = Float64Array.from(s.vel);
    const force = createDirectForce({ softening: 1e-4 });
    const fwd = createReversibleAdaptive(s, force, { dtMax: 1e-2, softening: 1e-4 });
    const N = 400;
    for (let k = 0; k < N; k++) expect(fwd.stepOnce()).toBe(true);
    const rho = fwd.density;

    for (let i = 0; i < s.vel.length; i++) s.vel[i] = -s.vel[i]!;
    const back = createReversibleAdaptive(s, force, {
      dtMax: 1e-2,
      softening: 1e-4,
      density0: rho, // carried, not re-seeded
    });
    for (let k = 0; k < N; k++) expect(back.stepOnce()).toBe(true);

    for (let i = 0; i < pos0.length; i++) expect(s.pos[i]!).toBeCloseTo(pos0[i]!, 14);
    /* Velocities return NEGATED, which is what reversal means. */
    for (let i = 0; i < vel0.length; i++) expect(s.vel[i]!).toBeCloseTo(-vel0[i]!, 12);
  });
});

describe("createReversibleAdaptive — it actually adapts", () => {
  it("shortens the step for a tighter pair, unlike a fixed scheme", () => {
    const force = createDirectForce({ softening: 1e-5 });
    const stepFor = (r: number): number => {
      const s = twoBody(30, 20, r);
      const it = createReversibleAdaptive(s, force, { dtMax: 1, softening: 1e-5 });
      it.step(1e-4);
      return it.lastPhysicalStep;
    };
    const wide = stepFor(0.1);
    const tight = stepFor(0.01);
    expect(tight).toBeLessThan(wide);
    /* omega ~ r^-3/2, so a tenth the separation should buy roughly 10^1.5 shorter steps.
       Loose bounds: rho has evolved a little by the time it is read. */
    expect(wide / tight).toBeGreaterThan(10);
    expect(wide / tight).toBeLessThan(100);
  });

  it("respects dtMax when nothing is fast", () => {
    const s = twoBody(1e-6, 1e-6, 50);
    const force = createDirectForce({ softening: 1e-4 });
    const it = createReversibleAdaptive(s, force, { dtMax: 1e-3, softening: 1e-4 });
    it.step(1e-2);
    expect(it.lastPhysicalStep).toBeLessThanOrEqual(1e-3 * (1 + 1e-6));
  });
});

describe("createReversibleAdaptive — the error does not go secular", () => {
  it("holds a bounded |dE/E| on an eccentric Kepler orbit over many periods", () => {
    /*
     * e = 0.9 is the regime this exists for: a fixed step cannot follow periapsis, and a naive
     * controller would be irreversible and drift. The assertion is on the SHAPE of the error —
     * the second half must not be systematically worse than the first — not merely on its size,
     * because a small-but-growing error is the failure mode being ruled out.
     */
    const m1 = 30;
    const m2 = 20;
    const a = 0.02;
    const ecc = 0.9;
    const s = twoBody(m1, m2, a * (1 + ecc), ecc);
    const force = createDirectForce({ softening: 0 });
    const period = 2 * Math.PI * Math.sqrt(a ** 3 / (G * (m1 + m2)));
    const it = createReversibleAdaptive(s, force, { dtMax: period / 20, softening: 0 });
    const e0 = it.energy().total;
    const drift: number[] = [];
    for (let k = 0; k < 40; k++) {
      it.step(period / 2);
      drift.push(Math.abs((it.energy().total - e0) / e0));
    }
    const firstHalf = Math.max(...drift.slice(0, 20));
    const secondHalf = Math.max(...drift.slice(20));
    expect(Math.max(...drift)).toBeLessThan(1e-4);
    /* Bounded, not secular: the late maximum may not be an order of magnitude past the early one. */
    expect(secondHalf).toBeLessThan(firstHalf * 10);
  });
});

describe("createReversibleAdaptive — it refuses what it cannot do", () => {
  it("throws on a force model with no force gradient, rather than silently degrading", () => {
    const noGradient = {
      id: "fake",
      accelerations: () => {},
      potentialEnergy: () => 0,
    } as unknown as Parameters<typeof createReversibleAdaptive>[1];
    expect(() =>
      createReversibleAdaptive(twoBody(10, 10, 1), noGradient, { dtMax: 1 }),
    ).toThrow(/forceGradient/);
  });
});
