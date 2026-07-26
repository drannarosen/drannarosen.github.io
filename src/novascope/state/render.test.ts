/*
 * The render-model selectors (Architecture §9.4).
 *
 * `scripts/check-render.mjs` already gates that these are well-formed and physically sensible —
 * finite sizes, remnants leaving the HR diagram, hot stars upper-left. What is here instead is the
 * property that gate cannot state: that the analytic overlay is drawn from the SAME law the bars
 * were sampled from. See ADR 0017 for the boundary.
 */
import { describe, expect, it } from "vitest";
import { defaultIdentity, sampleCluster } from "../core/cluster/index.ts";
import { toIMFHistogram } from "./render.ts";

describe("toIMFHistogram", () => {
  const mk = (kind: "kroupa" | "maschberger") =>
    defaultIdentity({
      seed: 3,
      sampling: { mode: "count", target: 3000 },
      imf: { kind, mMin: 0.1, mMax: 100, alphaHigh: 2.3 },
    });

  it("integrates the expectation to N, under either law", () => {
    for (const kind of ["maschberger", "kroupa"] as const) {
      const id = mk(kind);
      const m = toIMFHistogram(sampleCluster(id), id);
      const total = m.bins.reduce((t, b) => t + b.expected, 0);
      expect(Math.abs(total - 3000) / 3000).toBeLessThan(0.02);
    }
  });

  it("conserves the sampled counts", () => {
    const id = mk("kroupa");
    const m = toIMFHistogram(sampleCluster(id), id);
    expect(m.bins.reduce((t, b) => t + b.count, 0)).toBe(3000);
  });

  it("draws the overlay from the identity's OWN law, not always Maschberger", () => {
    /*
     * THE BUG THIS PINS. `expected` was computed with `maschbergerMassFraction` unconditionally,
     * under a comment that said "the analytic Kroupa law". Under a Kroupa identity the bars would
     * have been drawn from one distribution and the smooth line over them from another — a figure
     * asserting a fit that was never performed.
     *
     * The laws differ most at the low-mass end, where Maschberger turns over and Kroupa does not,
     * so the first bin is the discriminating one.
     */
    const kId = mk("kroupa");
    const mId = mk("maschberger");
    const kFirst = toIMFHistogram(sampleCluster(kId), kId).bins[0]!.expected;
    const mFirst = toIMFHistogram(sampleCluster(mId), mId).bins[0]!.expected;
    expect(Math.abs(kFirst - mFirst) / mFirst).toBeGreaterThan(0.02);
  });

  it("a flatter high-mass slope predicts more massive stars, under either law", () => {
    /* A physical property, so it must hold whichever law is selected. */
    for (const kind of ["maschberger", "kroupa"] as const) {
      const steep = defaultIdentity({ seed: 3, sampling: { mode: "count", target: 3000 }, imf: { kind, alphaHigh: 2.8 } });
      const flat = defaultIdentity({ seed: 3, sampling: { mode: "count", target: 3000 }, imf: { kind, alphaHigh: 1.7 } });
      const top = (id: typeof steep) => {
        const bins = toIMFHistogram(sampleCluster(id), id).bins;
        return bins[bins.length - 1]!.expected;
      };
      expect(top(flat)).toBeGreaterThan(top(steep));
    }
  });
});
