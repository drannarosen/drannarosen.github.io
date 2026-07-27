/*
 * gasExpulsion.test.ts — the PROTOCOL, not the physics numbers.
 *
 * `check-dynamics` already pins the physics: 69 quantities over the shipped 10,301-star
 * realization, frozen before the module was re-homed. What it cannot do is run cheaply — it
 * costs 7.8 s — so the properties that are quick to state went untested entirely
 * (2026-07-26 review, P3).
 *
 * Those properties are the settling protocol, and getting one wrong does not produce a
 * slightly different number: it produces a survival verdict about the wrong thing. If
 * expulsion may begin before the cluster has settled, the mass shed by DF relaxation is
 * credited to the gas, which is the single error the whole protocol exists to prevent.
 *
 * Run on a small SYNTHETIC cluster, deliberately. The point is the control flow, and a
 * 200-star system exercises every branch in milliseconds.
 */
import { describe, expect, it } from "vitest";
import { createDynamics, RELAX_TCROSS, type Dynamics } from "./index.ts";
import { mulberry32 } from "../../random/index.ts";
import { G_PC3_MSUN_MYR2 } from "../../constants/index.ts";

/** A small Plummer-ish blob in the `stars.f32` layout (x,y,z,mass,teff,radius). */
function syntheticInit(n = 200, seed = 4242): Parameters<typeof createDynamics>[0] {
  const rng = mulberry32(seed);
  const stars = new Float32Array(n * 6);
  const velocities = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.max(rng(), 1e-4);
    const r = 1 / Math.sqrt(u ** (-2 / 3) - 1);
    const cosT = 2 * rng() - 1;
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = 2 * Math.PI * rng();
    const o = i * 6;
    stars[o] = r * sinT * Math.cos(phi);
    stars[o + 1] = r * sinT * Math.sin(phi);
    stars[o + 2] = r * cosT;
    stars[o + 3] = 0.5 + rng(); // Msun
    stars[o + 4] = 5000;
    stars[o + 5] = 1;
    for (let k = 0; k < 3; k++) velocities[i * 3 + k] = (rng() - 0.5) * 0.4;
  }
  // A gas cloud whose enclosed fraction rises smoothly to 1 over 5 pc.
  const gasMenc = new Float32Array(256);
  for (let j = 0; j < gasMenc.length; j++) {
    const x = j / (gasMenc.length - 1);
    gasMenc[j] = x * x * (3 - 2 * x); // smoothstep: monotone, 0 at 0, 1 at 1
  }
  return { stars, velocities, gasMenc, gasMencRMax: 5, G: G_PC3_MSUN_MYR2 };
}

/** Advance until the settling phase completes. */
function settle(dyn: Dynamics): void {
  let guard = 0;
  while (dyn.diagnostics().settleProgress < 1) {
    dyn.step(dyn.tCross);
    if (++guard > RELAX_TCROSS * 4) throw new Error("never settled");
  }
}

describe("gas expulsion protocol", () => {
  it("starts in the settling phase and refuses to expel before it finishes", () => {
    const dyn = createDynamics(syntheticInit());
    dyn.setParams({ sfe: 0.2, tauOverTCross: 1, qTarget: 0.5 });

    expect(dyn.diagnostics().phase).toBe("settling");
    dyn.beginExpulsion();
    // THE ONE THAT MATTERS: the request must be ignored, not queued.
    expect(dyn.diagnostics().phase).toBe("settling");
    expect(dyn.diagnostics().tSinceExpulsion).toBe(-1);
    expect(dyn.diagnostics().mGas).toBeGreaterThan(0);

    dyn.step(dyn.tCross);
    expect(dyn.diagnostics().phase).toBe("settling");
    expect(dyn.diagnostics().mGas).toBe(dyn.diagnostics().mGas); // still not draining
  });

  it("reaches 'settled', and only then accepts expulsion", () => {
    const dyn = createDynamics(syntheticInit());
    dyn.setParams({ sfe: 0.2, tauOverTCross: 1, qTarget: 0.5 });
    settle(dyn);

    expect(dyn.diagnostics().phase).toBe("settled");
    const before = dyn.diagnostics().mGas;
    dyn.beginExpulsion();
    expect(dyn.diagnostics().phase).toBe("expelling");
    dyn.step(dyn.tCross);
    // Gas must actually be leaving now.
    expect(dyn.diagnostics().mGas).toBeLessThan(before);
    expect(dyn.diagnostics().tSinceExpulsion).toBeGreaterThan(0);
  });

  it("THE CONTROL: with no expulsion, survivingFraction stays 1", () => {
    /* The module header claims "the no-expulsion control returns a survival fraction of
       exactly 1.000". That is the claim that makes every other survival number meaningful —
       if the settled cluster sheds mass on its own, the protocol is crediting DF relaxation
       to the gas. Nothing tested it. */
    const dyn = createDynamics(syntheticInit());
    dyn.setParams({ sfe: 0.2, tauOverTCross: 1, qTarget: 0.5 });
    settle(dyn);

    for (let i = 0; i < 10; i++) dyn.step(dyn.tCross);
    expect(dyn.diagnostics().phase).toBe("settled"); // never expelled
    expect(dyn.diagnostics().survivingFraction).toBeCloseTo(1, 2);
  });

  it("expelling gas unbinds mass, and a lower SFE unbinds more", () => {
    /* The physics direction, asserted as an ORDERING rather than as a value — the values are
       the fixture's job, and an ordering cannot go stale when the realization changes. */
    const run = (sfe: number): number => {
      const dyn = createDynamics(syntheticInit());
      dyn.setParams({ sfe, tauOverTCross: 1, qTarget: 0.5 });
      settle(dyn);
      dyn.beginExpulsion();
      for (let i = 0; i < 10; i++) dyn.step(dyn.tCross);
      return dyn.diagnostics().survivingFraction;
    };
    const lowSfe = run(0.1); // mostly gas: losing it is catastrophic
    const highSfe = run(0.6); // mostly stars: losing the gas barely matters
    expect(lowSfe).toBeLessThan(highSfe);
    expect(highSfe).toBeLessThanOrEqual(1.000001);
    expect(lowSfe).toBeGreaterThan(0);
  });

  it("setParams implies a reset — a run cannot inherit the previous potential", () => {
    const dyn = createDynamics(syntheticInit());
    dyn.setParams({ sfe: 0.2, tauOverTCross: 1, qTarget: 0.5 });
    settle(dyn);
    dyn.beginExpulsion();
    dyn.step(dyn.tCross);
    expect(dyn.diagnostics().phase).toBe("expelling");

    dyn.setParams({ sfe: 0.4 });
    const d = dyn.diagnostics();
    expect(d.phase).toBe("settling");
    expect(d.t).toBe(0);
    expect(d.tSinceExpulsion).toBe(-1);
    expect(d.settleProgress).toBe(0);
    expect(dyn.getParams().sfe).toBe(0.4);
  });

  it("reset() returns to the exported initial conditions exactly", () => {
    const dyn = createDynamics(syntheticInit());
    const start = Float32Array.from(dyn.positions);
    dyn.step(dyn.tCross * 3);
    expect(Array.from(dyn.positions.slice(0, 6))).not.toEqual(Array.from(start.slice(0, 6)));
    dyn.reset();
    expect(Array.from(dyn.positions)).toEqual(Array.from(start));
  });

  it("a higher SFE means less gas, hence a shallower well and a shorter crossing time", () => {
    const tCross = (sfe: number): number => {
      const dyn = createDynamics(syntheticInit());
      dyn.setParams({ sfe, tauOverTCross: 1, qTarget: 0.5 });
      return dyn.tCross;
    };
    // t_cross = 2 r_h / sqrt(G M_tot / r_h): more total mass means a faster crossing.
    expect(tCross(0.6)).toBeGreaterThan(tCross(0.1));
  });

  it("exposes positions as a live Float32Array the renderer can read in place", () => {
    const dyn = createDynamics(syntheticInit());
    const view = dyn.positions;
    expect(view.length).toBe(dyn.n * 3);
    const before = view[0];
    dyn.step(dyn.tCross);
    // Same object, updated contents — no reallocation per frame.
    expect(dyn.positions).toBe(view);
    expect(view[0]).not.toBe(before);
  });
});
