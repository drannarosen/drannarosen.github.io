import { describe, expect, it } from "vitest";
import { K_B_CGS, M_HYDROGEN_G, M_SUN_G, PC_CM } from "../constants/index.ts";
import {
  C_II_KMS,
  dFrontRadius,
  dFrontSpeed,
  enclosedGasMass,
  hiiTrapped,
  ionizedDensity,
  ionizedMass,
  mergedHiiRegion,
  MU_ION,
  T_II,
  numberDensity,
  stromgrenRadius,
} from "./photoionization.ts";

/** Uniform-density stand-in: M(<r)/M = (r/rmax)^3. */
const UNIFORM = Array.from({ length: 512 }, (_, i) => (i / 511) ** 3);
const RMAX = 4;

describe("enclosedGasMass", () => {
  it("is bounded by the total, which is the whole point", () => {
    /* The defect this replaced: M_sh = (4/3)pi r^3 rho_local summed per star gave
       450-577x the entire residual gas reservoir. A profile lookup cannot. */
    expect(enclosedGasMass(1e6, 1000, UNIFORM, RMAX)).toBe(1000);
    expect(enclosedGasMass(RMAX, 1000, UNIFORM, RMAX)).toBe(1000);
  });

  it("reproduces the r^3 law it was handed", () => {
    expect(enclosedGasMass(2, 1000, UNIFORM, RMAX)).toBeCloseTo(1000 * 0.5 ** 3, 1);
  });

  it("is zero at and below the origin", () => {
    expect(enclosedGasMass(0, 1000, UNIFORM, RMAX)).toBe(0);
    expect(enclosedGasMass(-1, 1000, UNIFORM, RMAX)).toBe(0);
  });

  it("is monotone in r", () => {
    let prev = -1;
    for (let r = 0; r <= RMAX; r += RMAX / 64) {
      const m = enclosedGasMass(r, 1000, UNIFORM, RMAX);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
});

describe("Spitzer D-front", () => {
  it("starts at R_S and at the ionized sound speed", () => {
    expect(dFrontRadius(0.5, 0)).toBeCloseTo(0.5, 12);
    expect(dFrontSpeed(0.5, 0)).toBeCloseTo(C_II_KMS, 12);
  });

  it("expands and decelerates", () => {
    expect(dFrontRadius(0.5, 3)).toBeGreaterThan(dFrontRadius(0.5, 1));
    expect(dFrontSpeed(0.5, 3)).toBeLessThan(dFrontSpeed(0.5, 1));
  });

  it("approaches R ~ t^{4/7} and v ~ t^{-3/7} at late times", () => {
    /* The exponents are what make the H II channel super-linear in momentum
       (p ~ R^3 v ~ t^{9/7}) and so not scalable from its endpoint. */
    const r1 = dFrontRadius(0.01, 100), r2 = dFrontRadius(0.01, 200);
    expect(Math.log2(r2 / r1)).toBeCloseTo(4 / 7, 2);
    const v1 = dFrontSpeed(0.01, 100), v2 = dFrontSpeed(0.01, 200);
    expect(Math.log2(v2 / v1)).toBeCloseTo(-3 / 7, 2);
  });
});

describe("mergedHiiRegion", () => {
  const S = 5e50, R_CLOUD = 2.5, M_GAS = 1.6e4;
  const nH = numberDensity(M_GAS / ((4 / 3) * Math.PI * R_CLOUD ** 3));
  const at = (t: number) => mergedHiiRegion(S, nH, t, M_GAS, UNIFORM, RMAX, R_CLOUD);

  it("never sweeps more than the cloud holds", () => {
    for (const t of [0, 0.1, 1, 3, 10, 100]) {
      expect(at(t).shellMass).toBeLessThanOrEqual(M_GAS + 1e-6);
    }
  });

  it("never runs past the cloud radius", () => {
    for (const t of [0, 1, 10, 1000]) expect(at(t).radius).toBeLessThanOrEqual(R_CLOUD + 1e-9);
  });

  it("FREEZES at cloud-filling rather than stopping", () => {
    /* Setting the speed to zero once the front fills the cloud made the channel's
       momentum VANISH, which surfaced as a non-monotonic trajectory. Freezing at
       t_fill is correct: no more mass, no more momentum, but none lost either. */
    const late = at(50), later = at(500);
    expect(late.cloudFilling).toBe(true);
    expect(later.momentum).toBeCloseTo(late.momentum, 10);
    expect(later.momentum).toBeGreaterThan(0);
  });

  it("delivers momentum monotonically in time", () => {
    let prev = -1;
    for (let t = 0; t <= 20; t += 0.25) {
      const p = at(t).momentum;
      expect(p).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p;
    }
  });

  it("starts non-zero — the initial Stromgren sphere already encloses mass", () => {
    /* Not a discontinuity: at the cloud mean density R_S is ~0.5 pc, not the
       ~1e-5 pc the old per-star model gave from saturated cell densities. */
    expect(at(0).momentum).toBeGreaterThan(0);
    expect(at(0).momentum).toBeLessThan(at(3).momentum);
  });

  it("returns nothing when there are no ionizing photons", () => {
    const none = mergedHiiRegion(0, nH, 3, M_GAS, UNIFORM, RMAX, R_CLOUD);
    expect(none.momentum).toBe(0);
    expect(none.shellMass).toBe(0);
  });
});

describe("hiiTrapped", () => {
  it("switches the channel off exactly where v_esc exceeds the ionized sound speed", () => {
    /* This is what makes `compact` (v_esc = 20.3 km/s) lose a channel outright:
       thermal expansion cannot drive gas out however large Q becomes. */
    expect(hiiTrapped(C_II_KMS - 0.01)).toBe(false);
    expect(hiiTrapped(C_II_KMS + 0.01)).toBe(true);
    expect(hiiTrapped(20.3)).toBe(true);
    expect(hiiTrapped(8.4)).toBe(false);
  });
});

describe("stromgrenRadius", () => {
  it("scales as Q^{1/3} n^{-2/3}", () => {
    expect(stromgrenRadius(8e49, 100) / stromgrenRadius(1e49, 100)).toBeCloseTo(2, 6);
    expect(stromgrenRadius(1e49, 100) / stromgrenRadius(1e49, 800)).toBeCloseTo(4, 6);
  });
});


describe("ionized composition", () => {
  /* MU_ION and C_II_KMS were both free literals until 2026-09-04 -- MU_ION did
     not exist and C_II_KMS was a bare 10.0 with no citation. These pin them to
     the composition MU already encodes, so a change to one cannot silently
     leave the other behind. */

  it("derives mu_ion from the same helium abundance MU encodes", () => {
    // MU = 1 + 4y => y = 0.1; ionized particles per H nucleus = 2 + 2y = 2.2
    expect(MU_ION).toBeCloseTo(1.4 / 2.2, 12);
  });

  it("puts c_II at the isothermal sound speed of that gas, not a round number", () => {
    const expected = Math.sqrt((K_B_CGS * T_II) / (MU_ION * M_HYDROGEN_G)) / 1e5;
    expect(C_II_KMS).toBeCloseTo(expected, 10);
    expect(C_II_KMS).toBeCloseTo(9.5289, 3);
    expect(C_II_KMS).not.toBe(10.0);
  });

  it("keeps the trapping verdict on the right side for the shipped environments", () => {
    expect(hiiTrapped(2.4)).toBe(false); // diffuse
    expect(hiiTrapped(8.6)).toBe(false); // orion -- 0.93 km/s of margin, not 1.4
    expect(hiiTrapped(20.9)).toBe(true); // compact
  });
});

describe("ionized interior vs swept shell", () => {
  /* The H II thermal energy used the SWEPT NEUTRAL mass with the NEUTRAL mu
     while calling itself "over the ionized gas". Nothing tested it, which is
     why it survived. These are that test. */

  it("is lighter than the swept shell, because the interior is evacuated", () => {
    const q = 1e49;
    const nH = 100;
    const rs = stromgrenRadius(q, nH);
    const r = 4 * rs; // well into the D-type phase
    // swept mass at the ambient density, the quantity that used to be used
    const swept =
      (1.4 * M_HYDROGEN_G * nH * (4 / 3) * Math.PI * (r * PC_CM) ** 3) / M_SUN_G;
    const ionized = ionizedMass(q, r);
    expect(ionized).toBeGreaterThan(0);
    expect(ionized).toBeLessThan(swept);
    // n_ion / n_ambient = (R_S/R)^{3/2} for the recombination-balance interior
    expect(ionized / swept).toBeCloseTo((rs / r) ** 1.5, 6);
  });

  it("scales the interior mass as r^{3/2}, not r^3", () => {
    const q = 1e49;
    const a = ionizedMass(q, 1.0);
    const b = ionizedMass(q, 2.0);
    expect(b / a).toBeCloseTo(2 ** 1.5, 6);
  });

  it("ties the merged region's thermal energy to the ionized mass", () => {
    const reg = mergedHiiRegion(1e50, 100, 0.5, 1e4, UNIFORM, 5, 5);
    const kT_over_mu = (K_B_CGS * T_II) / (MU_ION * M_HYDROGEN_G);
    const expected = 1.5 * ionizedMass(1e50, reg.radius) * (kT_over_mu / 1e10);
    expect(reg.thermalEnergy).toBeCloseTo(expected, 6);
    // and it is NOT the swept shell, which is the bug this replaced
    const wrong = 1.5 * reg.shellMass * (kT_over_mu / 1e10);
    expect(reg.thermalEnergy).toBeLessThan(wrong);
  });

  it("reports zero thermal energy when there is no ionizing source", () => {
    expect(ionizedMass(0, 1)).toBe(0);
    expect(ionizedMass(1e49, 0)).toBe(0);
  });
});

describe("ionizedDensity", () => {
  it("balances recombination against the photon rate", () => {
    // n = sqrt(3 phi S / (4 pi alpha_B r^3)) -- doubling S raises n by sqrt(2)
    expect(ionizedDensity(2e49, 1) / ionizedDensity(1e49, 1)).toBeCloseTo(Math.SQRT2, 9);
  });
});
