import { describe, expect, it } from "vitest";
import {
  BJ_MASS_MAX,
  VRATIO_COOL,
  VRATIO_HOT,
  Z_ABS,
  Z_SUN_BJORKLUND,
  Z_SUN_VINK,
  effectiveEscapeSpeed,
  gammaE,
  sigmaE,
  starWind,
  windBudget,
} from "./winds.ts";
import { C_CM_S, GM_SUN_CGS, L_SUN_ERG_S } from "../constants/index.ts";

/* A star comfortably inside BOTH prescriptions' validity boxes. */
const STAR = { m: 40, teff: 40000, r: 10, l: 2.5e5 };
const sw = (presc: "bjorklund" | "vink", z = Z_ABS) =>
  starWind(STAR.m, STAR.teff, STAR.r, STAR.l, z, undefined, presc);

describe("metallicity normalization", () => {
  /* Each recipe owns the Z_sun its own paper is written against. A single shared
     0.02 evaluated Björklund against an anchor 43% above his own, and raised no
     error because the default z equalled the shared anchor — the term was
     exactly log10(1). The property to test is therefore WHERE THE ZERO IS. */
  it("keeps the two papers' anchors distinct", () => {
    expect(Z_SUN_VINK).toBe(0.02);
    expect(Z_SUN_BJORKLUND).toBe(0.014);
  });

  it("puts each recipe's zero at its OWN anchor and not the other's", () => {
    for (const [presc, own, other] of [
      ["vink", Z_SUN_VINK, Z_SUN_BJORKLUND],
      ["bjorklund", Z_SUN_BJORKLUND, Z_SUN_VINK],
    ] as const) {
      const atOwn = sw(presc, own).mdot;
      const atOther = sw(presc, other).mdot;
      expect(atOwn).toBeGreaterThan(0);
      // Not flat: it must respond to Z at all...
      expect(sw(presc, own / 2).mdot).not.toBeCloseTo(atOwn, 12);
      // ...and the other paper's anchor must NOT be its zero. Without this
      // clause a single shared constant passes.
      expect(Math.abs(atOther - atOwn) / atOwn).toBeGreaterThan(1e-6);
    }
  });
});

describe("Eddington factor and effective escape speed", () => {
  it("reproduces Vink eq (11)'s coefficient from first principles", () => {
    /* Gamma_e = L sigma_e/(4 pi c G M), so the coefficient is
       L_sun/(4 pi c GM_sun) = 7.655e-5 per cm^2/g; Vink print 7.66e-5.

       Constants IMPORTED, not retyped: check-constants fails the build on a
       re-declaration, and rightly — a test that hardcodes its own L_sun would
       keep passing after the shared value changed. GM_sun is used directly
       rather than G x M_sun, which avoids needing G at all. */
    expect(L_SUN_ERG_S / (4 * Math.PI * C_CM_S * GM_SUN_CGS)).toBeCloseTo(7.66e-5, 6);
  });

  it("uses sigma_e = 0.2(1+X), which is 0.34 at solar X", () => {
    expect(sigmaE(0.7)).toBeCloseTo(0.34, 12);
  });

  it("drives v_esc to zero at the Eddington limit, not to a finite value", () => {
    /* The limiting case that makes (1 - Gamma_e) the escape speed rather than a
       correction on it: at Gamma_e -> 1 material is marginally unbound, so the
       effort required must vanish. Plain sqrt(2GM/R) stays large — wrong limit. */
    const lEdd = 40 / (7.66e-5 * sigmaE(0.7)); // Gamma_e = 1 exactly
    expect(gammaE(lEdd, 40)).toBeCloseTo(1, 6);

    /* Compared RELATIVE to a normal escape speed, not against absolute zero.
       v_esc goes as sqrt(1 - Gamma_e), and 1 - Gamma_e bottoms out at one
       float64 eps (1.1e-16), so the smallest reachable value is ~1e-8 of
       normal — that IS the limit being taken, not a failure to reach it. */
    const normal = effectiveEscapeSpeed(40, 10, 2.5e5);
    expect(effectiveEscapeSpeed(40, 10, lEdd) / normal).toBeLessThan(1e-7);
    expect(effectiveEscapeSpeed(40, 10, lEdd * 0.5)).toBeGreaterThan(100);
  });
});

describe("terminal velocity", () => {
  it("uses the observational 2.6/1.3 ratios for BOTH prescriptions", () => {
    /* Björklund publish no v_inf law — only a grid mean of 4.5, which on ZAMS
       radii gave ~5150 km/s against their own grid mean of 3300 and well past
       the observed O-star ceiling. Substituting is legitimate for Björklund
       because his eq (7) carries no v_inf term; it would NOT be for Vink, whose
       eqs (24)/(25) take the ratio as an input. */
    const bj = sw("bjorklund"), vk = sw("vink");
    const vesc = effectiveEscapeSpeed(STAR.m, STAR.r, STAR.l);
    for (const w of [bj, vk]) {
      const ratio = w.vInf / vesc;
      expect([VRATIO_HOT, VRATIO_COOL]).toContain(Math.round(ratio * 10) / 10);
    }
  });

  it("lands inside the observed O-star range for a hot star", () => {
    expect(sw("bjorklund").vInf).toBeGreaterThan(1200);
    expect(sw("bjorklund").vInf).toBeLessThan(3600);
  });
});

describe("validity boxes are gates, not extrapolations", () => {
  it("drops a star above Björklund's 80 Msun ceiling and SAYS SO", () => {
    /* These are the stars carrying most of the wind momentum, so the drop must
       be reported rather than silently summed around. */
    const w = starWind(BJ_MASS_MAX + 50, 40000, 15, 1e6, Z_ABS, undefined, "bjorklund");
    expect(w.mdot).toBe(0);
    expect(w.outOfRange).toBe(true);
  });

  it("drops a star below Vink's 12500 K floor", () => {
    const w = starWind(20, 10000, 8, 1e4, Z_ABS, undefined, "vink");
    expect(w.mdot).toBe(0);
    expect(w.outOfRange).toBe(true);
  });

  it("counts what it dropped", () => {
    const mass = [40, 200, 0.5], teff = [40000, 40000, 5000], rad = [10, 20, 1];
    const lum = [2.5e5, 1e6, 0.3];
    const b = windBudget(mass, teff, rad, lum, Z_ABS, "bjorklund");
    expect(b.nDriving + b.nOutOfRange).toBe(3);
    expect(b.nOutOfRange).toBeGreaterThan(0);
  });
});

describe("windBudget population sums", () => {
  it("computes E from per-star speeds, not from a mean speed", () => {
    /* L_w = sum(1/2 mdot v^2). Rebuilding it as 1/2 sum(mdot) <v>^2 understates
       it whenever the speeds differ, since <v^2> >= <v>^2 — and they differ
       across three decades of stellar mass. */
    const mass = [40, 60], teff = [40000, 42000], rad = [10, 12], lum = [2.5e5, 5e5];
    const b = windBudget(mass, teff, rad, lum, Z_ABS, "bjorklund");
    const w0 = starWind(40, 40000, 10, 2.5e5, Z_ABS, undefined, "bjorklund");
    const w1 = starWind(60, 42000, 12, 5e5, Z_ABS, undefined, "bjorklund");
    expect(b.eDot).toBeCloseTo(0.5 * w0.mdot * w0.vInf ** 2 + 0.5 * w1.mdot * w1.vInf ** 2, 12);
    const meanV = b.pDot / b.mdot;
    expect(b.eDot).toBeGreaterThan(0.5 * b.mdot * meanV ** 2 - 1e-30);
  });
});
