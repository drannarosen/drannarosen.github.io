/*
 * extinction.test.ts — do the ported curves reproduce their papers?
 *
 * These are PORTED coefficients, so the question is not "is the arithmetic self-consistent"
 * but "did the port land". Every assertion below is therefore anchored on something external:
 * a normalization the paper defines, a validity range it states, a sign change it describes,
 * or — best of all — the published comparison between the two laws in Gordon+2023's own Fig 8.
 *
 * A test that checked these curves against themselves would pass for a transcription error in
 * any coefficient.
 */
import { describe, expect, it } from "vitest";
import {
  attenuation,
  attenuationFor,
  colourExcess,
  EXTINCTION_LAWS,
  extinctionLaw,
  R_V_MW,
} from "./index.ts";
import { ccm89AOverAv, ccm89Covers } from "./ccm89.ts";
import { g23AOverAv, g23Covers, G23_RV_RANGE } from "./g23.ts";
import { PASSBANDS } from "../photometry/passbands.ts";

describe("CCM89", () => {
  it("is normalized EXACTLY at its own anchor, for every R_V", () => {
    /* a(0) = 1 and b(0) = 0 at y = x - 1.82 = 0, so A/A_V = 1 independent of R_V. That is a
       property of the published polynomials, so a transcription error in the constant term of
       either would break it. Measured: 1.000000000000 at every R_V tried. */
    for (const rv of [2.5, 3.1, 4.0, 5.5]) {
      expect(ccm89AOverAv(1000 / 1.82, rv)).toBeCloseTo(1, 12);
    }
  });

  it("does NOT return 1 at this repo's V band, and that is a convention difference", () => {
    /* V here is 552.4 nm (the curve's own transmission-weighted mean) against CCM89's
       1.82 um^-1 = 549.45 nm. The 0.6% gap is the two conventions disagreeing, not an error,
       and pinning it stops someone "fixing" it later. */
    const atV = ccm89AOverAv(PASSBANDS.V.lambdaEffNm, 3.1);
    expect(atV).toBeCloseTo(0.9939, 3);
    expect(atV).not.toBeCloseTo(1, 3);
  });

  it("refuses the three bands outside its published branches, rather than extrapolating", () => {
    /* The UV branch (Eqs 4a/4b) is not in the verified digest and is not implemented. The
       failure mode this guards against is specific: at HST F275W the optical polynomial
       returns 0.978 — BELOW its own value at the valid edge (1.80), when extinction should be
       rising steeply into the near-UV. A plausible number, and wrong. */
    for (const id of ["HST_F275W", "JWST_F444W", "JWST_F770W"]) {
      expect(ccm89Covers(PASSBANDS[id].lambdaEffNm)).toBe(false);
      expect(Number.isNaN(ccm89AOverAv(PASSBANDS[id].lambdaEffNm, 3.1))).toBe(true);
    }
    // …and covers the other 27.
    const covered = Object.values(PASSBANDS).filter((b) => ccm89Covers(b.lambdaEffNm));
    expect(covered.length).toBe(Object.keys(PASSBANDS).length - 3);
  });
});

describe("G23", () => {
  it("covers every passband in this repo — which is why it is the default", () => {
    for (const b of Object.values(PASSBANDS)) {
      expect(g23Covers(b.lambdaEffNm)).toBe(true);
      expect(Number.isFinite(g23AOverAv(b.lambdaEffNm, 3.1))).toBe(true);
    }
  });

  it("is normalized APPROXIMATELY at V — a global fit, not a curve pinned to unity", () => {
    /* The digest records "A(lambda)/A(V) ~ 1 at lambda ~ 550 nm (fit, not exact)". Measured
       0.9839. Asserting equality with 1 would be asserting a property G23 does not have, and
       the difference from CCM89's exact 1 is a real difference between the two models. */
    const atV = g23AOverAv(550, 3.1);
    expect(atV).toBeCloseTo(0.9839, 3);
    expect(Math.abs(atV - 1)).toBeGreaterThan(1e-3);
    expect(Math.abs(atV - 1)).toBeLessThan(0.05);
  });

  it("shows the b(lambda) sign change at 0.55 um that the paper describes", () => {
    /* Anchor from the digest: b > 0 blueward of 0.55 um, b < 0 redward. Since
       A/A_V = a + b(1/R_V - 1/3.1), raising R_V lowers (1/R_V), so a positive b means a
       HIGHER R_V gives LESS extinction in the blue — bigger grains, greyer curve. The sign
       must flip across 0.55 um, and it does. */
    const blueLo = g23AOverAv(400, 2.5);
    const blueHi = g23AOverAv(400, 5.5);
    expect(blueHi).toBeLessThan(blueLo); // blue: rises with grain size => less extinction

    const redLo = g23AOverAv(800, 2.5);
    const redHi = g23AOverAv(800, 5.5);
    expect(redHi).toBeGreaterThan(redLo); // red: the other way round
  });

  it("clamps R_V to the fitted range instead of extrapolating the linear form", () => {
    expect(g23AOverAv(550, 1.0)).toBe(g23AOverAv(550, G23_RV_RANGE.min));
    expect(g23AOverAv(550, 99)).toBe(g23AOverAv(550, G23_RV_RANGE.max));
  });
});

describe("the two laws against each other", () => {
  it("reproduces the published G23-vs-CCM89 deviation from Gordon+2023 Fig 8", () => {
    /* THE STRONGEST TEST IN THIS FILE. The paper reports, at R_V = 3.1, an average fractional
     * deviation of 0.03 and a maximum of 0.18 between its own curve and CCM89. Reproducing
     * both numbers from two independently transcribed coefficient sets is a real check that
     * the port landed — a wrong digit in either law would move them.
     *
     * Measured over x = 0.3..3.3 in steps of 0.005: ave 0.0356, max 0.1653. The sampling grid
     * is ours rather than the paper's, so exact agreement is not expected and is not asserted;
     * the bounds bracket the published figures generously enough to survive that while still
     * failing on any real transcription error, which would shift these by far more.
     */
    const devs: number[] = [];
    for (let x = 0.3; x <= 3.3; x += 0.005) {
      const nm = 1000 / x;
      const c = ccm89AOverAv(nm, 3.1);
      const g = g23AOverAv(nm, 3.1);
      if (Number.isFinite(c) && Number.isFinite(g) && c > 0) devs.push(Math.abs(g - c) / c);
    }
    const ave = devs.reduce((a, b) => a + b, 0) / devs.length;
    const max = Math.max(...devs);

    expect(ave).toBeGreaterThan(0.01);
    expect(ave).toBeLessThan(0.06); // published 0.03, measured 0.0356
    expect(max).toBeGreaterThan(0.10);
    expect(max).toBeLessThan(0.25); // published 0.18, measured 0.1653
  });

  it("both agree that bluer light is extinguished more", () => {
    // The single most basic property of interstellar dust, in both laws.
    const order = ["U", "B", "V", "R", "I", "J", "K"];
    for (const law of [ccm89AOverAv, g23AOverAv]) {
      const values = order.map((id) => law(PASSBANDS[id].lambdaEffNm, 3.1));
      for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
    }
  });
});

describe("attenuation", () => {
  it("A_V = 0 returns EXACTLY 1, and attenuationFor returns undefined", () => {
    /* The property that lets extinction land without perturbing a single shipped page: the
       no-extinction path must be provably the original one, not arithmetic that rounds to 1. */
    for (const nm of [271, 550, 7663]) {
      expect(attenuation(nm, { aV: 0 })).toBe(1);
      expect(attenuation(nm, { aV: 0, law: "ccm89" })).toBe(1);
    }
    expect(attenuationFor(undefined)).toBeUndefined();
    expect(attenuationFor({ aV: 0 })).toBeUndefined();
    expect(attenuationFor({ aV: 0.5 })).toBeTypeOf("function");
  });

  it("dims and never brightens, and dims the blue more", () => {
    const blue = attenuation(400, { aV: 1 });
    const red = attenuation(800, { aV: 1 });
    expect(blue).toBeGreaterThan(0);
    expect(blue).toBeLessThan(1);
    expect(red).toBeLessThan(1);
    expect(blue).toBeLessThan(red); // more extinction in the blue => less transmitted
  });

  it("is monotone in A_V", () => {
    let previous = 1;
    for (const aV of [0.5, 1, 2, 5]) {
      const t = attenuation(550, { aV });
      expect(t).toBeLessThan(previous);
      previous = t;
    }
  });

  it("matches 10^(-0.4 A_V) at a wavelength where A/A_V is 1", () => {
    // CCM89's exact anchor, so this checks the magnitude convention end to end.
    const nm = 1000 / 1.82;
    expect(attenuation(nm, { aV: 1, law: "ccm89" })).toBeCloseTo(10 ** -0.4, 12);
    expect(attenuation(nm, { aV: 2.5, law: "ccm89" })).toBeCloseTo(10 ** -1, 12);
  });

  it("returns NaN outside a law's domain rather than a plausible number", () => {
    const nm = PASSBANDS.HST_F275W.lambdaEffNm;
    expect(Number.isNaN(attenuation(nm, { aV: 1, law: "ccm89" }))).toBe(true);
    expect(Number.isFinite(attenuation(nm, { aV: 1, law: "g23" }))).toBe(true);
  });

  it("attenuationFor agrees with attenuation", () => {
    const spec = { aV: 1.3, rv: 4.0, law: "g23" as const };
    const fn = attenuationFor(spec)!;
    for (const nm of [300, 550, 1200, 5000]) {
      expect(fn(nm)).toBeCloseTo(attenuation(nm, spec), 12);
    }
  });
});

describe("the law registry", () => {
  it("offers G23 first, because it is the one that covers everything", () => {
    expect(EXTINCTION_LAWS[0].id).toBe("g23");
    expect(EXTINCTION_LAWS.map((l) => l.id)).toEqual(["g23", "ccm89"]);
    for (const law of EXTINCTION_LAWS) expect(law.citation).toMatch(/\d{4}/);
  });

  it("states CCM89's R_V range as unknown rather than inventing one", () => {
    expect(extinctionLaw("g23").rvRange).toEqual(G23_RV_RANGE);
    expect(extinctionLaw("ccm89").rvRange).toBeNull();
  });

  it("throws on an unknown law instead of silently defaulting", () => {
    // @ts-expect-error — deliberately wrong, to prove it is not silently tolerated.
    expect(() => extinctionLaw("f99")).toThrow(/unknown extinction law/);
  });
});

describe("colourExcess", () => {
  it("is the definition R_V = A_V / E(B-V), rearranged", () => {
    expect(colourExcess(3.1, 3.1)).toBeCloseTo(1, 12);
    expect(colourExcess(1, 3.1)).toBeCloseTo(1 / 3.1, 12);
    expect(colourExcess(2, R_V_MW)).toBeCloseTo(2 / 3.1, 12);
  });

  it("differs from integrating the curve through THIS repo's B and V, by a small amount", () => {
    /* R_V is defined on monochromatic effective wavelengths; our bands are measured curves
       with their own weighted means. So A_B - A_V computed here is NOT exactly A_V/R_V, and
       the honest assertion is that the gap is small and stable rather than zero. Doing the
       full band integral is `core/photometry`'s job; this is the monochromatic stand-in. */
    const aV = 1;
    const aB = aV * g23AOverAv(PASSBANDS.B.lambdaEffNm, 3.1);
    const aVband = aV * g23AOverAv(PASSBANDS.V.lambdaEffNm, 3.1);
    const measured = aB - aVband;
    const definitional = colourExcess(aV, 3.1);
    // Measured 0.319 against a definitional 0.323 — about 1%, and it must stay small.
    expect(Math.abs(measured / definitional - 1)).toBeLessThan(0.15);
    expect(measured).toBeGreaterThan(0);
  });
});
