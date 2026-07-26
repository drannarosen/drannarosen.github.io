/*
 * Unit tests for the IMF laws. See ADR 0017 for why these are Vitest and not a check-*.mjs gate:
 * these are properties of the FUNCTIONS (normalisation, monotonicity, endpoints, guards), while
 * `scripts/check-imf.mjs` is a reference-parity audit against a committed progenax fixture. The
 * two answer different questions and neither replaces the other.
 */
import { describe, expect, it } from "vitest";
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
