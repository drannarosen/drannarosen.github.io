import { describe, expect, it } from "vitest";
import {
  ALPHA_P_TARGET,
  LANCASTER_ALPHA_P_BRACKET,
  LANCASTER_ALPHA_P_LYC,
  bubbleCeiling,
  calibrateWindLeak,
  etaAtLeak,
  etaPorousKM09,
  weaverRadius,
  weaverTimeToRadius,
  windLeakForEta,
} from "./bubble.ts";

describe("Weaver similarity solution", () => {
  it("expands as t^{3/5}", () => {
    const r1 = weaverRadius(1e36, 1e-21, 1e12);
    const r2 = weaverRadius(1e36, 1e-21, 2e12);
    expect(Math.log2(r2 / r1)).toBeCloseTo(3 / 5, 6);
  });

  it("inverts consistently", () => {
    /* RELATIVE, not toBeCloseTo: t is 3.7e12, so an absolute tolerance is
       meaningless here — the round-trip through a 5th power and a cbrt lands
       within ~18 float64 eps, which is the floor, not an error. */
    const t = 3.7e12;
    const r = weaverRadius(1e36, 1e-21, t);
    const back = weaverTimeToRadius(1e36, 1e-21, r);
    expect(Math.abs(back - t) / t).toBeLessThan(1e-12);
  });
});

describe("bubbleCeiling — eta_max", () => {
  const MSUN = 1.989e33;
  const ceil = (lw: number, pdot: number) => bubbleCeiling(lw, pdot, 2e4, 2.5, 3.2);

  it("is floored at the momentum-conserving limit", () => {
    /* Below eta = 1 the expression has no meaning: the shell cannot receive less
       than the momentum the wind physically carried. */
    expect(ceil(1e30, 1e30).etaMax).toBeGreaterThanOrEqual(1);
    expect(bubbleCeiling(0, 0, 2e4, 2.5, 3.2).etaMax).toBe(1);
  });

  it("equals sqrt(eps M_shell / M_wind) with eps = 15/77, the Weaver shell-KE share", () => {
    /* This is what eta MEANS: momentum is bought by handing the wind's energy to
       a much heavier payload, p = sqrt(2ME). Verified against the shipped
       `orion` numbers, where it holds to ~1% (the residual is Weaver's a=0.76
       coefficient bookkeeping). */
    const mdot = 3.1e-6, vinf = 2993; // Msun/yr, km/s
    const lw = 0.5 * ((mdot * MSUN) / 3.156e7) * (vinf * 1e5) ** 2;
    const pdot = ((mdot * MSUN) / 3.156e7) * (vinf * 1e5);
    const c = bubbleCeiling(lw, pdot, 20406, 2.5, 3.2);
    const mWind = mdot * c.tBreakoutMyr * 1e6;
    const predicted = Math.sqrt((15 / 77) * (20406 / mWind));
    expect(c.etaMax / predicted).toBeCloseTo(1, 1);
  });

  it("caps at breakout — there is no more cloud to sweep past r_cloud", () => {
    /* Evaluating at the full window credits momentum to material that is not
       there, and inflates eta_max 3-4x. */
    const c = bubbleCeiling(1e37, 1e28, 2e4, 2.5, 3.2);
    expect(c.breaksOut).toBe(true);
    expect(c.tBreakoutMyr).toBeLessThan(3.2);
  });
});

describe("leakage calibration", () => {
  it("windLeakForEta inverts etaAtLeak exactly", () => {
    for (const etaMax of [30, 96.2, 149.4]) {
      for (const target of [1.5, 4, 5.375, 8]) {
        expect(etaAtLeak(etaMax, windLeakForEta(etaMax, target))).toBeCloseTo(target, 9);
      }
    }
  });

  it("targets the geometric midpoint of Lancaster's two with-LyC averages", () => {
    expect(ALPHA_P_TARGET).toBeCloseTo(
      Math.sqrt(LANCASTER_ALPHA_P_LYC[0] * LANCASTER_ALPHA_P_LYC[1]), 12,
    );
    expect(ALPHA_P_TARGET).toBeGreaterThan(LANCASTER_ALPHA_P_BRACKET[0]);
    expect(ALPHA_P_TARGET).toBeLessThan(LANCASTER_ALPHA_P_BRACKET[1]);
  });

  it("centres the RANGE, keeping both extremes inside the bracket", () => {
    /* Centring on the median instead pushed Vink's `diffuse` to eta = 11.6,
       outside the paper's own 3-8 reference lines. */
    const spread = [30.4, 39.6, 71.0];
    const f = calibrateWindLeak(spread);
    const etas = spread.map((em) => etaAtLeak(em, f));
    const [lo, hi] = LANCASTER_ALPHA_P_BRACKET;
    for (const e of etas) {
      expect(e).toBeGreaterThanOrEqual(lo);
      expect(e).toBeLessThanOrEqual(hi);
    }
    expect(Math.sqrt(Math.min(...etas) * Math.max(...etas))).toBeCloseTo(ALPHA_P_TARGET, 2);
  });
});

describe("etaPorousKM09 — the porous-bubble coupling", () => {
  it("gives NO boost at KM09's own realistic covering fraction", () => {
    /* The disagreement this encodes, asserted so it cannot be quietly tuned
       away: at C_f <= 1/2 KM09's analysis returns eta = 1 — a purely
       momentum-driven bubble — against the 4.5-6.5 that Lancaster's measured
       alpha_p calibrates. */
    expect(etaPorousKM09(0)).toBe(1);
    expect(etaPorousKM09(0.4)).toBe(1);
    expect(etaPorousKM09(0.5)).toBe(1);
  });

  it("needs a nearly-sealed shell to reach Lancaster's value", () => {
    const cf = (1 - 1 / (Math.sqrt(5) * ALPHA_P_TARGET)) / 1.02;
    expect(cf).toBeCloseTo(0.899, 3);
    expect(etaPorousKM09(cf)).toBeCloseTo(ALPHA_P_TARGET, 6);
  });

  it("rises monotonically once past the floor", () => {
    let prev = 0;
    for (let cf = 0.6; cf < 0.95; cf += 0.05) {
      const e = etaPorousKM09(cf);
      expect(e).toBeGreaterThan(prev);
      prev = e;
    }
  });

  it("diverges past C_f = 1/1.02, which KM09 say is not real", () => {
    expect(Number.isFinite(etaPorousKM09(0.99))).toBe(false);
  });
});
