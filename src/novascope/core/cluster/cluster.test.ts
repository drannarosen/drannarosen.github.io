/*
 * The cluster identity says which IMF it was drawn from.
 *
 * WHY THIS TEST EXISTS: `params.ts` documented the IMF as Kroupa while `sample.ts` called
 * `maschbergerMass`, so a serialised cluster asserted a law it was not drawn from — in a type that
 * goes into shareable URLs. Making the law explicit is what makes the identity honest, and the
 * last case here is what makes it more than a label.
 */
import { describe, expect, it } from "vitest";
import { defaultIdentity, sampleCluster, serializeIdentity, deserializeIdentity } from "./index.ts";
import { maschbergerMass, buildKroupaSegments, sampleKroupaMass } from "../imf/index.ts";

describe("the IMF law is part of the identity", () => {
  it("defaults to maschberger — what the code has always actually sampled", () => {
    expect(defaultIdentity().imf.kind).toBe("maschberger");
  });

  it("round-trips through the query string", () => {
    const id = defaultIdentity({ imf: { kind: "kroupa", mMin: 0.1, mMax: 60, alphaHigh: 2.3 } });
    expect(deserializeIdentity(serializeIdentity(id)).imf.kind).toBe("kroupa");
  });

  it("falls back to maschberger when the key is absent or unknown", () => {
    expect(deserializeIdentity("seed=1").imf.kind).toBe("maschberger");
    expect(deserializeIdentity("seed=1&im=salpeter").imf.kind).toBe("maschberger");
  });

  it("dispatches to a materially different law, measured without sampling noise", () => {
    /*
     * ── WHY THIS COMPARES THE LAWS AND NOT TWO SAMPLES ──
     *
     * The first version of this test asserted that the two populations' MEDIAN masses differ by
     * more than 0.02 M☉. That was a bad test twice over. It came out at 0.0194 and would have
     * been "fixed" by loosening the bound — tuning the assertion to the answer. And its stated
     * reasoning was wrong: it claimed Maschberger's turnover suppresses the lowest masses that
     * Kroupa keeps, but measured over [0.1, 60] Maschberger yields MORE stars below 0.2 M☉
     * (0.382 against 0.355), not fewer.
     *
     * The two laws are genuinely similar over these bounds — every sample statistic agrees to
     * 3-8% — so any threshold on a sample is chasing noise. The quantile functions have no noise:
     * the same u maps to two masses that differ by up to 9.8% (worst at u ≈ 0.99, measured
     * 2026-07-26). That is a property of two published formulas, both pinned by `check:imf`, so
     * it cannot drift.
     *
     * 5% is deliberately well below the measured 9.8% and far above zero. It asserts "these are
     * materially different laws", which is the claim, rather than reproducing a measurement.
     */
    const p = { mMin: 0.1, mMax: 60, alpha: 2.3 };
    const segs = buildKroupaSegments(0.1, 60, 2.3);
    let worst = 0;
    for (let i = 1; i < 1000; i++) {
      const u = i / 1000;
      const a = maschbergerMass(u, p);
      const b = sampleKroupaMass(u, segs);
      worst = Math.max(worst, Math.abs(a - b) / b);
    }
    expect(worst).toBeGreaterThan(0.05);
  });

  it("is deterministic in the seed, under either law", () => {
    for (const kind of ["maschberger", "kroupa"] as const) {
      const id = defaultIdentity({
        seed: 9,
        sampling: { mode: "count", target: 200 },
        imf: { kind, mMin: 0.1, mMax: 100, alphaHigh: 2.3 },
      });
      expect(sampleCluster(id)).toEqual(sampleCluster(id));
    }
  });

  it("keeps the mass and position sub-streams independent of the law", () => {
    /*
     * The sub-stream design (ADR 0012 §9.3) is what lets dynamics add velocities later without
     * reshuffling an existing cluster. Switching the IMF must therefore move the MASSES and leave
     * the POSITIONS exactly where they were — if it moves both, the streams have been merged.
     */
    const base = { seed: 5, sampling: { mode: "count" as const, target: 300 } };
    const m = sampleCluster(defaultIdentity({ ...base, imf: { kind: "maschberger", mMin: 0.1, mMax: 60, alphaHigh: 2.3 } }));
    const k = sampleCluster(defaultIdentity({ ...base, imf: { kind: "kroupa", mMin: 0.1, mMax: 60, alphaHigh: 2.3 } }));
    expect(k.map((s) => [s.x, s.y, s.z])).toEqual(m.map((s) => [s.x, s.y, s.z]));
    expect(k.map((s) => s.mass)).not.toEqual(m.map((s) => s.mass));
  });
});
