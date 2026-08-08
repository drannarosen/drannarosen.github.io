/*
 * ttl.test.ts — TTL's whole claim is that Omega is FREE, so the tests have to pin two things
 * that a plausible-looking implementation would get wrong silently: that Omega is the function
 * it says it is, and that the auxiliary variable actually tracks it.
 */
import { describe, expect, it } from "vitest";
import { createTTL } from "./ttl.ts";
import { createLogH } from "./logh.ts";
import { createDirectForce } from "./direct/index.ts";
import { createState } from "./types.ts";
import { KEPLER, KEPLER_PERIOD, keplerPair, keplerSeparation } from "./kepler.testutil.ts";

const SOFT = KEPLER.softening;
const force = () => createDirectForce({ G: KEPLER.G, softening: SOFT });

describe("ttl", () => {
  it("at beta = 1, Omega IS -U — which is what makes it LogH's generalisation", () => {
    /* The sharpest check on the pair sum: at beta = 1 with mass weighting, Omega is exactly
       the softened potential energy with the sign flipped. If the exponent, the softening or
       the mass weighting were coded wrong, this is where it shows — and nowhere else would,
       because a mis-scaled Omega still produces a perfectly plausible-looking integration. */
    const s = keplerPair();
    const f = force();
    const lf = createTTL(s, f, { softening: SOFT, beta: 1, G: KEPLER.G });
    const minusU = -f.potentialEnergy(s.pos, s.mass, 0);
    expect(lf.omegaNow()).toBeCloseTo(minusU, 12);
  });

  it("keeps its auxiliary W tracking Omega — the thing that makes it work at all", () => {
    /* W is advanced by its own rate rather than recomputed, so nothing forces it to stay on
       Omega. If Omega' had a wrong sign or a wrong exponent the integration would still run
       and still look sane; this is the assertion that catches it. */
    const s = keplerPair();
    const lf = createTTL(s, force(), { softening: SOFT, beta: 2, G: KEPLER.G, order: 4 });
    let worst = 0;
    for (let k = 0; k < 600; k++) {
      lf.stepFictitious(2e-4);
      worst = Math.max(worst, Math.abs(lf.w - lf.omegaNow()) / lf.omegaNow());
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it("is time-reversible", () => {
    /* TTL is NOT symplectic — W is not canonical — so reversibility is what its bounded error
       rests on, and it is the property the two-halves W update in `kick` exists to preserve. */
    const s = keplerPair();
    const lf = createTTL(s, force(), { softening: SOFT, beta: 2, G: KEPLER.G, order: 4 });
    const p0 = Array.from(s.pos);
    const v0 = Array.from(s.vel);
    const H = 5e-4;
    for (let i = 0; i < 200; i++) lf.stepFictitious(H);
    for (let i = 0; i < 200; i++) lf.stepFictitious(-H);
    expect(Math.max(...s.pos.map((v, i) => Math.abs(v - p0[i])))).toBeLessThan(1e-9);
    expect(Math.max(...s.vel.map((v, i) => Math.abs(v - v0[i])))).toBeLessThan(1e-9);
    expect(Math.abs(lf.t)).toBeLessThan(1e-9);
  });

  it("is second or fourth order in the fictitious step, as its `order` says", () => {
    /* Local error against a converged reference — see the long note in logh.test.ts for why it
       must be local: Kepler is too kind and a three-body global study measures chaos. */
    const threeBody = () => {
      const s = createState(3);
      s.mass[0] = 1;
      s.mass[1] = 0.7;
      s.mass[2] = 0.4;
      s.pos[0] = -1;
      s.pos[1] = 0.2;
      s.pos[3] = 1.1;
      s.pos[4] = -0.1;
      s.pos[6] = 0.15;
      s.pos[7] = 1.0;
      s.vel[0] = 0.1;
      s.vel[1] = -0.35;
      s.vel[3] = -0.05;
      s.vel[4] = 0.3;
      s.vel[6] = -0.12;
      s.vel[7] = 0.05;
      return s;
    };
    const f = () => createDirectForce({ G: 1, softening: 1e-3 });
    const advance = (order: 2 | 4, H: number, nSub: number) => {
      const s = threeBody();
      const lf = createTTL(s, f(), { softening: 1e-3, beta: 2, G: 1, order });
      for (let i = 0; i < nSub; i++) lf.stepFictitious(H / nSub);
      return { pos: Array.from(s.pos), t: lf.t };
    };
    const localError = (order: 2 | 4, H: number) => {
      const one = advance(order, H, 1);
      const ref = advance(order, H, 2048);
      return Math.max(...one.pos.map((v, i) => Math.abs(v - ref.pos[i])), Math.abs(one.t - ref.t));
    };
    for (const [order, expected] of [
      [2, 2],
      [4, 4],
    ] as const) {
      const p = Math.log2(localError(order, 0.02) / localError(order, 0.01)) - 1;
      expect(p).toBeGreaterThan(expected - 0.5);
      expect(p).toBeLessThan(expected + 0.7);
    }
  });

  it("shortens its step where a pair closes, and beta sets HOW HARD", () => {
    /* The reason the file exists. beta is the lever on how sharply the step responds, and the
       assertion is on the ORDERING rather than on numbers, so it states the design claim
       without pinning values a retune would break. */
    /* Driven to a fixed PHYSICAL time, not a fixed step count. A count is the wrong loop
       bound for an adaptive scheme by definition — beta changes Omega's magnitude and so the
       physical step, and the first version of this test ran 3000 steps that covered 15% of an
       orbit, giving rMax/rMin = 1.03 and nothing to respond to. */
    const range = (beta: number) => {
      const s = keplerPair();
      const lf = createTTL(s, force(), { softening: SOFT, beta, G: KEPLER.G, order: 2 });
      let lo = Infinity;
      let hi = 0;
      let rMin = Infinity;
      let rMax = 0;
      let guard = 0;
      while (lf.t < KEPLER_PERIOD && guard++ < 500_000) {
        lf.stepFictitious(1e-3);
        lo = Math.min(lo, lf.lastPhysicalStep);
        hi = Math.max(hi, lf.lastPhysicalStep);
        const r = keplerSeparation(s);
        rMin = Math.min(rMin, r);
        rMax = Math.max(rMax, r);
      }
      return { ratio: hi / lo, rRatio: rMax / rMin };
    };
    const b1 = range(1);
    const b2 = range(2);
    // The orbit was actually sampled across its range, so the comparison means something.
    expect(b1.rRatio).toBeGreaterThan(2);
    // Both adapt...
    expect(b1.ratio).toBeGreaterThan(1.5);
    // ...and a steeper Omega adapts harder. That is the knob's whole purpose.
    expect(b2.ratio).toBeGreaterThan(b1.ratio);
  });

  it("refuses a configuration with no pair structure rather than dividing by zero", () => {
    const lone = createState(1);
    lone.mass[0] = 1;
    expect(() => createTTL(lone, force(), { softening: SOFT, G: KEPLER.G })).toThrow(/Omega/);
  });

  it("keeps the energy error bounded on the orbit LogH is exact on", () => {
    /* Not a claim to beat LogH here — LogH solves Kepler's energy exactly and nothing beats
       that. This asserts TTL does not go SECULAR on the same problem, which is what would
       happen if the time-symmetry were broken. */
    const s = keplerPair();
    const lf = createTTL(s, force(), { softening: SOFT, beta: 2, G: KEPLER.G, order: 4 });
    const e0 = lf.energy().total;
    const drift = () => Math.abs((lf.energy().total - e0) / e0);
    let early = 0;
    while (lf.t < 5 * KEPLER_PERIOD) {
      lf.stepFictitious(5e-4);
      early = Math.max(early, drift());
    }
    let late = 0;
    while (lf.t < 25 * KEPLER_PERIOD) lf.stepFictitious(5e-4);
    while (lf.t < 30 * KEPLER_PERIOD) {
      lf.stepFictitious(5e-4);
      late = Math.max(late, drift());
    }
    expect(late).toBeLessThan(early * 5);
  });
});
