import { describe, expect, it } from "vitest";
import { cloudBinding, effBindingCoefficient, effEscapeCoefficient } from "./binding.ts";

/* The shipped natal profile and one shallow variant. */
const G4 = { gamma: 4.2, rtOverA: 2.5 / 0.8 };
const G3 = { gamma: 3.2, rtOverA: 2.5 / 0.8 };

describe("effBindingCoefficient — alpha", () => {
  it("exceeds the uniform sphere, because EFF is centrally concentrated", () => {
    /* |W| = (3/5) GM^2/R for a uniform sphere. Any profile with more mass in the
       middle binds harder, so alpha > 3/5 is a floor the shape guarantees. */
    expect(effBindingCoefficient(G4.gamma, G4.rtOverA)).toBeGreaterThan(0.6);
    expect(effBindingCoefficient(G3.gamma, G3.rtOverA)).toBeGreaterThan(0.6);
  });

  it("rises with gamma — steeper means more mass deep", () => {
    expect(effBindingCoefficient(4.2, G4.rtOverA)).toBeGreaterThan(
      effBindingCoefficient(3.2, G4.rtOverA),
    );
  });

  it("is converged in the grid", () => {
    const a = effBindingCoefficient(4.2, G4.rtOverA, 2048);
    const b = effBindingCoefficient(4.2, G4.rtOverA, 8192);
    expect(Math.abs(a - b) / b).toBeLessThan(1e-3);
  });
});

describe("effEscapeCoefficient — beta", () => {
  /* THE test for this module. As r_t/a -> 0 only the flat EFF core is kept and the
     cloud becomes a uniform sphere, whose potential is known exactly:

       Phi(r) = -(GM/2R)(3 - r^2/R^2)
       beta   = (1/sqrt2) int_0^1 3x^2 sqrt(3-x^2) dx
              = (27/8)[theta - sin(4 theta)/4]/sqrt2,  theta = asin(1/sqrt3)

     This validates the interior term, the exterior (shell-theorem) term and the
     mass weighting together — none of which a monotonicity check would catch.

     NOTE it is 1.0938, NOT 1. An earlier version of this expectation used the
     round number and failed against correct code: a uniform sphere's centre is
     deeper than its edge by sqrt(3/2). */
  it("matches the uniform-sphere closed form in the small-r_t limit", () => {
    const theta = Math.asin(1 / Math.sqrt(3));
    const closed = ((27 / 8) * (theta - Math.sin(4 * theta) / 4)) / Math.SQRT2;
    expect(closed).toBeCloseTo(1.093833, 5);
    expect(effEscapeCoefficient(4.2, 0.02)).toBeCloseTo(closed, 3);
  });

  it("is exactly 1 at the surface by construction, so beta > 1 measures depth alone", () => {
    for (const [g, rta] of [[4.2, 3.125], [3.2, 3.125], [3.0, 2.0], [5.0, 10]] as const) {
      expect(effEscapeCoefficient(g, rta)).toBeGreaterThan(1);
    }
  });

  it("rises with gamma", () => {
    expect(effEscapeCoefficient(4.2, 3.125)).toBeGreaterThan(effEscapeCoefficient(3.2, 3.125));
  });

  it("is converged in the grid", () => {
    const a = effEscapeCoefficient(4.2, 3.125, 2048);
    const b = effEscapeCoefficient(4.2, 3.125, 8192);
    expect(Math.abs(a - b) / b).toBeLessThan(1e-3);
  });
});

describe("cloudBinding", () => {
  const B = cloudBinding(20406.04, 2.5, 4.2, 0.8);

  it("charges the gas the MASS-WEIGHTED speed, not the surface one", () => {
    /* The bug this replaced: M_gas v_esc(r_t) understated the threshold ~38%,
       because the gas is spread through the profile, not sitting at the edge. */
    expect(B.vEscMassWeighted).toBeGreaterThan(B.vEsc);
    expect(B.vEscMassWeighted).toBeCloseTo(B.beta * B.vEsc, 10);
    expect(B.momentum).toBeCloseTo(20406.04 * B.vEscMassWeighted, 6);
  });

  it("still reports the surface speed, which the export and the H II test use", () => {
    expect(B.vEsc).toBeCloseTo(Math.sqrt((2 * 4.300917270e-3 * 20406.04) / 2.5), 10);
  });

  it("scales as M^2/r_t in energy and M^{3/2}/r_t^{1/2} in momentum", () => {
    const b2 = cloudBinding(2 * 20406.04, 2.5, 4.2, 0.8);
    expect(b2.energy / B.energy).toBeCloseTo(4, 6);
    expect(b2.momentum / B.momentum).toBeCloseTo(2 * Math.SQRT2, 6);
  });
});
