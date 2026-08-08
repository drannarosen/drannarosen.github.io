/*
 * binaries.test.ts — the diagnostic has to find the pair the INTEGRATOR feels, not a
 * plausible-looking one. Every assertion here is against a configuration whose answer is
 * known analytically, so a sign error cannot pass by looking reasonable.
 */
import { describe, expect, it } from "vitest";
import { hardestBoundPair, pairResolution } from "./binaries.ts";
import { createState } from "./types.ts";
import { KEPLER, KEPLER_PERIOD, keplerPair } from "./kepler.testutil.ts";

describe("binaries", () => {
  it("recovers the known semi-major axis and period of the Kepler fixture", () => {
    const s = keplerPair();
    const pair = hardestBoundPair(s, KEPLER.softening, KEPLER.G);
    expect(pair).not.toBeNull();
    // The fixture is built with a = 1; softening is 1e-5, so it barely perturbs.
    expect(pair!.semiMajorAxis).toBeCloseTo(KEPLER.a, 4);
    expect(pair!.period).toBeCloseTo(KEPLER_PERIOD, 4);
    expect(pair!.masses).toEqual([KEPLER.m, KEPLER.m]);
    // Started at apoapsis: r = a(1 + e).
    expect(pair!.separation).toBeCloseTo(KEPLER.a * (1 + KEPLER.eccentricity), 10);
  });

  it("returns null when nothing is bound, rather than the least unbound pair", () => {
    /* Two stars flying apart fast. A diagnostic that returned "the tightest pair" regardless
       would let the page announce a binary in a cluster that has none. */
    const s = createState(2);
    s.mass[0] = 1;
    s.mass[1] = 1;
    s.pos[0] = -0.5;
    s.pos[3] = 0.5;
    s.vel[1] = -50;
    s.vel[4] = 50;
    expect(hardestBoundPair(s, 1e-5, KEPLER.G)).toBeNull();
  });

  it("picks the MOST bound pair, not the closest one", () => {
    /* The distinction that makes this a dynamics diagnostic rather than a proximity search:
       a close pair flying past each other is not a binary, and a wider slow pair can be far
       more bound. */
    const s = createState(4);
    const G = 1;
    // Pair A: very close, but unbound — high relative speed.
    s.mass[0] = 1;
    s.mass[1] = 1;
    s.pos[0] = 0;
    s.pos[3] = 0.05;
    s.vel[1] = -20;
    s.vel[4] = 20;
    // Pair B: four times wider, but nearly at rest — bound.
    s.mass[2] = 1;
    s.mass[3] = 1;
    s.pos[6] = 100;
    s.pos[9] = 100.2;
    const pair = hardestBoundPair(s, 1e-6, G);
    expect(pair).not.toBeNull();
    expect([pair!.i, pair!.j]).toEqual([2, 3]);
  });

  it("uses the SOFTENED potential, so it describes the pair being integrated", () => {
    /* At a separation comparable to the softening the two potentials differ a lot, and an
       unsoftened diagnostic would report a tighter, more alarming binary than the one the
       force model actually produces. */
    const mk = () => {
      const s = createState(2);
      s.mass[0] = 1;
      s.mass[1] = 1;
      s.pos[3] = 0.01;
      return s;
    };
    const hard = hardestBoundPair(mk(), 1e-8, 1)!;
    const soft = hardestBoundPair(mk(), 0.01, 1)!;
    // Softening weakens the binding, so the softened pair is the less bound of the two.
    expect(soft.bindingEnergy).toBeLessThan(hard.bindingEnergy);
  });

  it("reports steps per orbit, which is what predicts the energy error", () => {
    const s = keplerPair();
    const dt = KEPLER_PERIOD / 500;
    const res = pairResolution(s, KEPLER.softening, dt, KEPLER.G);
    expect(res!.stepsPerOrbit).toBeCloseTo(500, 2);
  });

  it("measures hardness against the mean stellar kinetic energy", () => {
    const s = keplerPair();
    const pair = hardestBoundPair(s, KEPLER.softening, KEPLER.G)!;
    /* A bound Kepler pair at apoapsis is more bound than its own kinetic energy, so hardness
       must exceed 1 — the conventional "this binary is hard" line. */
    expect(pair.hardness).toBeGreaterThan(1);
    expect(Number.isFinite(pair.hardness)).toBe(true);
  });
});
