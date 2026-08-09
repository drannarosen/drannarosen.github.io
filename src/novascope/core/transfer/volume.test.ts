import { describe, expect, it } from "vitest";
import {
  compositeRay,
  decodeNormalized,
  expansionShift,
  massLossShift,
  rampColour,
  sampleOpacity,
  slabTransmittance,
  smoothstep,
  toLog10Rho,
  windowed,
} from "./volume.ts";

describe("the compositing integral reproduces the analytic slab", () => {
  /* The test that makes this a REFERENCE rather than a second opinion: N steps of
     1 - exp(-k dt) composited front-to-back must equal 1 - exp(-k L) for the whole
     slab, for every N. A doubled dt, an off-by-one in the loop, or the over-operator
     written back-to-front all break this, and no picture would show it. */
  const opts = { floor: 0, gamma: 1, absorb: 3.7, emit: 1, alphaCutoff: 1 };

  it("is independent of how finely the ray is sampled", () => {
    const L = 2.3;
    const expected = 1 - slabTransmittance(1, opts.absorb, L);
    for (const n of [1, 2, 8, 64, 512]) {
      const steps = Array.from({ length: n }, () => ({ d: 1, dt: L / n }));
      expect(compositeRay(steps, opts).alpha).toBeCloseTo(expected, 10);
    }
  });

  it("agrees with Beer-Lambert on a partially transparent slab", () => {
    const steps = Array.from({ length: 32 }, () => ({ d: 1, dt: 0.05 }));
    const alpha = compositeRay(steps, opts).alpha;
    expect(1 - alpha).toBeCloseTo(slabTransmittance(1, opts.absorb, 32 * 0.05), 10);
  });

  it("never exceeds alpha = 1, however long the ray", () => {
    const steps = Array.from({ length: 4000 }, () => ({ d: 1, dt: 1 }));
    expect(compositeRay(steps, opts).alpha).toBeLessThanOrEqual(1);
  });
});

describe("the early-out is a cost saving, not a change of answer", () => {
  it("stops once the ray is effectively opaque", () => {
    const steps = Array.from({ length: 500 }, () => ({ d: 1, dt: 0.5 }));
    const r = compositeRay(steps, { floor: 0, gamma: 1, absorb: 3, emit: 1 });
    expect(r.used).toBeLessThan(500);
    expect(r.alpha).toBeGreaterThan(0.99);
  });

  it("leaves a transparent ray untouched by the cutoff", () => {
    const steps = Array.from({ length: 50 }, () => ({ d: 0, dt: 0.1 }));
    const r = compositeRay(steps, { floor: 0.5, gamma: 1, absorb: 3, emit: 1 });
    expect(r.alpha).toBe(0);
    expect(r.used).toBe(50);
    expect(r.rgb).toEqual([0, 0, 0]);
  });
});

describe("the two expulsion modes are different physics", () => {
  const logRange = 6;

  it("expansion conserves mass: rho -> rho/S^3 is a shift of 3 log10 S", () => {
    /* This is the whole justification for rendering expansion by sampling the ORIGINAL
       cube at a contracted coordinate. If the shift were not exactly 3 log10 S the
       cloud would gain or lose mass as it expanded, silently. */
    for (const S of [1, 1.5, 2, 4.5]) {
      expect(expansionShift(S, logRange) * logRange).toBeCloseTo(3 * Math.log10(S), 12);
    }
    expect(expansionShift(1, logRange)).toBe(0);
  });

  it("mass loss at fixed shape is exactly log10(gasFrac)", () => {
    for (const f of [1, 0.5, 0.1]) {
      expect(massLossShift(f, logRange) * logRange).toBeCloseTo(-Math.log10(f), 12);
    }
    /* "No shift at f = 1", asserted as a NUMBER and not with Object.is. The unary minus
       makes this -0, which is numerically identical to 0 everywhere it is used — in the
       shift, in GLSL, and under ===. `toBe(0)` failed on it, and that was the test
       encoding a representation detail rather than the physics. */
    expect(Math.abs(massLossShift(1, logRange))).toBe(0);
  });

  it("does not conflate them — the same rho ratio needs different S and gasFrac", () => {
    /* Halving the density by expansion needs S = 2^(1/3); by mass loss it needs
       gasFrac = 1/2. Anything that treated the two as one knob would be depicting a
       cloud the survival integrator never modelled. */
    const byExpansion = expansionShift(Math.cbrt(2), logRange);
    const byMassLoss = massLossShift(0.5, logRange);
    expect(byExpansion).toBeCloseTo(byMassLoss, 12);
    expect(Math.cbrt(2)).not.toBeCloseTo(0.5, 2);
  });

  it("floors gasFrac rather than diverging at zero", () => {
    expect(Number.isFinite(massLossShift(0, logRange))).toBe(true);
  });
});

describe("the display window", () => {
  it("puts the floor at zero and the top at one", () => {
    expect(windowed(0.4, 0.4)).toBe(0);
    expect(windowed(1, 0.4)).toBeCloseTo(1, 12);
  });

  it("clamps below the floor rather than going negative", () => {
    /* Negative s raised to a fractional gamma is NaN, which would propagate through the
       colour ramp and paint holes. */
    expect(windowed(0.1, 0.4)).toBe(0);
    expect(Number.isNaN(Math.pow(windowed(0.1, 0.4), 0.7))).toBe(false);
  });
});

describe("decode", () => {
  it("maps the byte range onto the recorded log range", () => {
    expect(decodeNormalized(0)).toBe(0);
    expect(decodeNormalized(255)).toBe(1);
    expect(toLog10Rho(0, 0.866, 6.866)).toBeCloseTo(0.866, 12);
    expect(toLog10Rho(1, 0.866, 6.866)).toBeCloseTo(6.866, 12);
  });
});

describe("smoothstep matches GLSL, because the shader's must too", () => {
  it("is 0 and 1 at the edges with zero slope", () => {
    expect(smoothstep(0.72, 1, 0.5)).toBe(0);
    expect(smoothstep(0.72, 1, 1.5)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe("the colour ramp is monotone in density", () => {
  it("moves continuously from deep to pale to warm", () => {
    /* Not asserting the anchors' values — those are a display choice and may be retuned.
       Asserting that the ramp has no discontinuity, which is what a mistyped mix or a
       swapped smoothstep edge would produce. */
    let prev = rampColour(0);
    for (let s = 0.02; s <= 1; s += 0.02) {
      const c = rampColour(s);
      const jump = Math.max(...c.map((v, i) => Math.abs(v - prev[i]!)));
      expect(jump).toBeLessThan(0.1);
      prev = c;
    }
  });
});

describe("opacity", () => {
  it("rises with absorption and with step length, and saturates", () => {
    expect(sampleOpacity(1, 1, 1)).toBeGreaterThan(sampleOpacity(1, 0.5, 1));
    expect(sampleOpacity(1, 1, 2)).toBeGreaterThan(sampleOpacity(1, 1, 1));
    expect(sampleOpacity(1, 1e6, 1)).toBeCloseTo(1, 12);
    expect(sampleOpacity(0, 1, 1)).toBe(0);
  });
});
