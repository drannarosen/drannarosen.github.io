import { describe, expect, it } from "vitest";
import { createStepGuard } from "./stepGuard.ts";

const TOL = 1e-4;

describe("stepGuard — when it fires", () => {
  it("stays out of the way below the first gate", () => {
    const g = createStepGuard({ tolerance: TOL });
    for (const d of [0, 1e-11, 1e-8, 9e-6]) expect(g.update(d, 0)).toBeNull();
    expect(g.scale).toBe(1);
    expect(g.drops).toBe(0);
  });

  it("fires at a FRACTION of the limit, so it cannot be late", () => {
    /* The whole point: pairWatch confirmed AFTER the breach on two seeds in three. This fires
       at a tenth of tolerance, which is necessarily before the breach. */
    const g = createStepGuard({ tolerance: TOL });
    const ev = g.update(0.11 * TOL, 4.2);
    expect(ev).not.toBeNull();
    expect(ev!.scale).toBe(0.5);
    expect(ev!.at).toBe(4.2);
    expect(g.scale).toBe(0.5);
  });

  it("halves once per gate, not once per sample above it", () => {
    /* A spike gives many samples over the gate; each must not cost a halving, or one close
       encounter would drive the step to nothing. */
    const g = createStepGuard({ tolerance: TOL });
    expect(g.update(0.15 * TOL, 1)).not.toBeNull();
    for (let k = 0; k < 50; k++) expect(g.update(0.15 * TOL, 1 + k)).toBeNull();
    expect(g.drops).toBe(1);
    expect(g.scale).toBe(0.5);
  });

  it("stages: a run that keeps climbing pays for more drops", () => {
    const g = createStepGuard({ tolerance: TOL });
    g.update(0.11 * TOL, 1);
    expect(g.scale).toBe(0.5);
    g.update(0.31 * TOL, 2);
    expect(g.scale).toBe(0.25);
    g.update(0.61 * TOL, 3);
    expect(g.scale).toBe(0.125);
  });

  it("STOPS after maxDrops, which is a correctness bound and not a knob", () => {
    /*
     * A few discrete changes give a sum of offsets; per-step control gives a random walk and a
     * secular error, which is the property fsi4.ts refuses a controller to protect. Unbounded
     * halving would turn this into that controller by degrees.
     */
    const g = createStepGuard({ tolerance: TOL });
    for (let k = 0; k < 100; k++) g.update(10 * TOL, k);
    expect(g.drops).toBe(3);
    expect(g.scale).toBe(0.125);
    expect(g.update(1e3 * TOL, 999)).toBeNull();
  });

  it("never lengthens the step", () => {
    /* Going back up would be a second change in the opposite direction and would put the
       shadow-Hamiltonian mismatch back in play for no benefit. */
    const g = createStepGuard({ tolerance: TOL });
    g.update(0.5 * TOL, 1);
    const after = g.scale;
    for (const d of [0, 1e-12, 1e-9]) g.update(d, 2);
    expect(g.scale).toBe(after);
  });

  it("ignores a non-finite drift rather than halving on it", () => {
    /* The monitor reports NaN with gravity off; a guard that fired there would shorten the step
       of a run that has no integrator error to speak of. */
    const g = createStepGuard({ tolerance: TOL });
    expect(g.update(NaN, 1)).toBeNull();
    expect(g.update(Infinity, 1)).toBeNull();
    expect(g.scale).toBe(1);
  });
});

describe("stepGuard — the record it keeps", () => {
  it("logs every change, so a page can say WHEN the step moved", () => {
    const g = createStepGuard({ tolerance: TOL });
    g.update(0.11 * TOL, 5.8);
    g.update(0.31 * TOL, 10.4);
    expect(g.events.map((e) => e.at)).toEqual([5.8, 10.4]);
    expect(g.events.map((e) => e.scale)).toEqual([0.5, 0.25]);
  });

  it("reset() clears the record as well as the scale", () => {
    const g = createStepGuard({ tolerance: TOL });
    g.update(TOL, 1);
    g.reset();
    expect(g.scale).toBe(1);
    expect(g.drops).toBe(0);
    expect(g.events).toHaveLength(0);
  });
});

describe("stepGuard — it refuses a configuration that would lie", () => {
  it("rejects a non-ascending gate list", () => {
    /* Descending gates would trip together on one spike and report three staged drops that were
       really one event. */
    expect(() => createStepGuard({ tolerance: TOL, gates: [0.3, 0.1] })).toThrow(/ascend/);
  });

  it("rejects a factor that does not shorten", () => {
    expect(() => createStepGuard({ tolerance: TOL, factor: 1 })).toThrow(/greater than 1/);
  });

  it("rejects a non-positive tolerance", () => {
    expect(() => createStepGuard({ tolerance: 0 })).toThrow(/positive tolerance/);
  });
});
