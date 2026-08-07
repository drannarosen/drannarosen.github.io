/*
 * axis.test.ts — the shared linear tick law.
 *
 * `niceTicks` was hand-rolled inside `/explore/dynamics` and drew the only linear
 * axes on the site, so it was the one axis routine no test could reach: the H–R
 * diagram and the IMF histogram are log–log with hard-coded decade ticks. These
 * assertions are what moving it into `viz/axis` buys.
 *
 * The endpoint case is the one that actually bit: an axis whose upper bound is an
 * exact multiple of the step (0..1 by 0.25) loses its last tick to floating-point
 * accumulation unless the loop guard carries an epsilon.
 */
import { describe, it, expect } from "vitest";
import { niceTicks } from "./axis.ts";

describe("niceTicks", () => {
  it("covers the range without running past it", () => {
    for (const [lo, hi] of [
      [0, 1],
      [0, 47.3],
      [0.92, 1.08],
      [-3, 12],
      [0, 1e-4],
      [0, 5e6],
    ] as const) {
      const t = niceTicks(lo, hi);
      expect(t.length, `${lo}..${hi}`).toBeGreaterThan(0);
      expect(Math.min(...t), `${lo}..${hi} low`).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(Math.max(...t), `${lo}..${hi} high`).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("keeps the final tick when the bound is an exact multiple of the step", () => {
    // Without the epsilon in the loop guard this returns [0, 0.25, 0.5, 0.75].
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("uses a 1/2/2.5/5/10 mantissa, so labels stay round", () => {
    const gaps = (t: number[]) => t[1]! - t[0]!;
    expect(gaps(niceTicks(0, 100, 4))).toBeCloseTo(25, 9);
    expect(gaps(niceTicks(0, 40, 4))).toBeCloseTo(10, 9);
    expect(gaps(niceTicks(0, 8, 4))).toBeCloseTo(2, 9);
  });

  it("produces roughly the requested number of ticks", () => {
    for (const hi of [1, 3, 7, 19, 44, 230, 17]) {
      const t = niceTicks(0, hi, 4);
      expect(t.length, `0..${hi}`).toBeGreaterThanOrEqual(3);
      expect(t.length, `0..${hi}`).toBeLessThanOrEqual(9);
    }
  });

  it("degenerates safely rather than looping forever", () => {
    expect(niceTicks(5, 5)).toEqual([5]); // zero span
    expect(niceTicks(5, 1)).toEqual([5]); // inverted
    expect(niceTicks(NaN, 1)).toEqual([]);
    expect(niceTicks(0, Infinity)).toEqual([]);
  });
});
