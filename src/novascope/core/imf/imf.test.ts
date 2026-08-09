/*
 * Unit tests for the IMF laws. See ADR 0017 for why these are Vitest and not a check-*.mjs gate:
 * these are properties of the FUNCTIONS (normalisation, monotonicity, endpoints, guards), while
 * `scripts/check-imf.mjs` is a reference-parity audit against a committed progenax fixture. The
 * two answer different questions and neither replaces the other.
 */
import { describe, expect, it } from "vitest";
import { IMF_M_MIN_MSUN, IMF_M_MAX_MSUN } from "./index.ts";
import { M_HYDROGEN_BURNING_MSUN } from "../constants/index.ts";
import { defaultIdentity } from "../cluster/params.ts";
import { maschbergerMass, maschbergerMassFraction } from "./index.ts";

describe("maschbergerMassFraction", () => {
  const p = { mMin: 0.1, mMax: 100, alpha: 2.3 };

  it("integrates to 1 over the full range", () => {
    expect(maschbergerMassFraction(0.1, 100, p)).toBeCloseTo(1, 12);
  });

  it("is monotone in the upper bound", () => {
    const a = maschbergerMassFraction(0.1, 1, p);
    const b = maschbergerMassFraction(0.1, 10, p);
    expect(b).toBeGreaterThan(a);
  });

  it("returns 0 for an inverted interval", () => {
    expect(maschbergerMassFraction(10, 1, p)).toBe(0);
  });
});

describe("maschbergerMass", () => {
  const p = { mMin: 0.1, mMax: 100, alpha: 2.3 };

  it("maps the unit interval onto the mass range, inclusive", () => {
    expect(maschbergerMass(0, p)).toBeCloseTo(0.1, 6);
    expect(maschbergerMass(1, p)).toBeCloseTo(100, 6);
  });

  it("is monotone increasing in u", () => {
    const us = [0.1, 0.3, 0.5, 0.7, 0.9];
    const ms = us.map((u) => maschbergerMass(u, p));
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
  });
});

describe("the mass range has ONE home", () => {
  /* These bounds had no test at all, which is how three copies came to disagree: the gravoturb
     export sampled from 0.01 Msun, params.ts said 0.1, and this module said nothing. Measured
     2026-08-09, 44% of every shipped catalogue was sub-stellar and a 131 Msun star sat in a
     catalogue whose own consumer could not have drawn one. The formula was gated; the population
     was not. */

  it("puts the floor at the hydrogen-burning limit, not below it", () => {
    expect(IMF_M_MIN_MSUN).toBe(M_HYDROGEN_BURNING_MSUN);
    expect(IMF_M_MIN_MSUN).toBe(0.08);
  });

  it("puts the ceiling at Maschberger's own fiducial m_u", () => {
    /* 150, from Table 1 — not progenax's 300 and not the 100 params.ts used to carry. */
    expect(IMF_M_MAX_MSUN).toBe(150);
  });

  it("is what defaultIdentity samples, so the site cannot drift from the export", () => {
    const id = defaultIdentity();
    expect(id.imf.mMin).toBe(IMF_M_MIN_MSUN);
    expect(id.imf.mMax).toBe(IMF_M_MAX_MSUN);
  });

  it("never draws a sub-stellar object, however extreme the quantile", () => {
    /* The property that actually matters — a floor is only a floor if the sampler respects it. */
    const p = { mMin: IMF_M_MIN_MSUN, mMax: IMF_M_MAX_MSUN, alpha: 2.3 };
    for (const u of [0, 1e-12, 1e-6, 0.5, 1 - 1e-12, 1]) {
      const m = maschbergerMass(u, p);
      expect(m).toBeGreaterThanOrEqual(IMF_M_MIN_MSUN - 1e-12);
      expect(m).toBeLessThanOrEqual(IMF_M_MAX_MSUN + 1e-9);
    }
  });

  it("puts most of the population BELOW a solar mass, as an IMF must", () => {
    /* Guards the opposite failure from the one that occurred: a floor raised so far that the
       low-mass majority disappears would also be wrong, and would look tidy. */
    const p = { mMin: IMF_M_MIN_MSUN, mMax: IMF_M_MAX_MSUN, alpha: 2.3 };
    const below = maschbergerMassFraction(IMF_M_MIN_MSUN, 1, p);
    expect(below).toBeGreaterThan(0.3);
    expect(below).toBeLessThan(0.95);
  });
});
