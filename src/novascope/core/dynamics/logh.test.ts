/*
 * logh.test.ts — the claim this scheme is FOR: an adaptive physical step that is still
 * symplectic, so the energy error stays bounded on exactly the orbits a fixed step fails on.
 *
 * The fixture is the shared eccentric Kepler pair, so these numbers sit beside `fsi4.test.ts`
 * and `hermite.test.ts` on the same problem rather than on a private one.
 */
import { describe, expect, it } from "vitest";
import { createLogH } from "./logh.ts";
import { createFsi4 } from "./fsi4.ts";
import { createDirectForce } from "./direct/index.ts";
import { createState } from "./types.ts";
import { KEPLER, KEPLER_PERIOD, keplerPair, keplerSeparation } from "./kepler.testutil.ts";

const force = () => createDirectForce({ G: KEPLER.G, softening: KEPLER.softening });

/** Peak |dE/E| over a run, sampled every whole step. */
function peakDrift(stepFn: () => void, energyFn: () => number, steps: number): number {
  const e0 = energyFn();
  let worst = 0;
  for (let k = 0; k < steps; k++) {
    stepFn();
    worst = Math.max(worst, Math.abs((energyFn() - e0) / e0));
  }
  return worst;
}

describe("logh", () => {
  it("advances physical time forward, and reports it rather than the requested dt", () => {
    const s = keplerPair();
    const lf = createLogH(s, force(), { maxStep: KEPLER_PERIOD / 200 });
    const t0 = lf.t;
    lf.step(KEPLER_PERIOD / 10);
    /* At least the requested amount — it stops on the next WHOLE fictitious step rather than
       truncating, which is the documented contract and the reason `t` is authoritative. */
    expect(lf.t).toBeGreaterThanOrEqual(t0 + KEPLER_PERIOD / 10);
    expect(lf.t - t0).toBeLessThan(KEPLER_PERIOD / 4);
  });

  it("VARIES the physical step, shrinking it where the pair is close", () => {
    const s = keplerPair();
    const lf = createLogH(s, force(), { maxStep: KEPLER_PERIOD / 400 });
    let atApo = 0;
    let atPeri = 0;
    let rMin = Infinity;
    let rMax = 0;
    // One full orbit, recording the physical step at the widest and tightest separations.
    for (let k = 0; k < 2000; k++) {
      lf.stepFictitious(1e-3);
      const r = keplerSeparation(s);
      if (r > rMax) {
        rMax = r;
        atApo = lf.lastPhysicalStep;
      }
      if (r < rMin) {
        rMin = r;
        atPeri = lf.lastPhysicalStep;
      }
    }
    // The orbit really was sampled across its range, so the comparison means something.
    expect(rMax / rMin).toBeGreaterThan(2);
    /* THE POINT: dt/ds = 1/(-U), so a tighter pair takes a smaller physical step with no
       criterion, no controller and no eta anywhere in the scheme. */
    expect(atPeri).toBeLessThan(atApo);
    expect(atApo / atPeri).toBeGreaterThan(2);
  });

  it("keeps the energy error BOUNDED over many orbits — it does not grow with time", () => {
    const s = keplerPair();
    const f = force();
    const lf = createLogH(s, f, { maxStep: KEPLER_PERIOD / 200 });
    const e0 = lf.energy().total;
    const drift = () => Math.abs((lf.energy().total - e0) / e0);

    // Peak over the FIRST five orbits against the peak over a much later five.
    let early = 0;
    while (lf.t < 5 * KEPLER_PERIOD) {
      lf.stepFictitious(1e-2);
      early = Math.max(early, drift());
    }
    let late = 0;
    while (lf.t < 45 * KEPLER_PERIOD) lf.stepFictitious(1e-2);
    while (lf.t < 50 * KEPLER_PERIOD) {
      lf.stepFictitious(1e-2);
      late = Math.max(late, drift());
    }
    /* Bounded means the late peak is no worse than the early one, up to a small factor. A
       secular scheme would show `late` an order of magnitude up after ten times the run. */
    expect(late).toBeLessThan(early * 3);
    expect(late).toBeLessThan(1e-6);
  });

  it("beats a fixed-step symplectic scheme where the fixed step is weakest: high eccentricity", () => {
    /* The regime that motivated the file. At e = 0.9 the periapsis speed is high and the
       separation small, so a step chosen for the orbit as a whole is far too coarse there —
       which is the same failure a hardening binary produces in the cluster. */
    const eccentric = (e: number) => {
      const a = KEPLER.a;
      const m = KEPLER.m;
      const rApo = a * (1 + e);
      const vApo = Math.sqrt((KEPLER.G * 2 * m * (1 - e)) / (a * (1 + e)));
      const st = createState(2);
      st.mass[0] = m;
      st.mass[1] = m;
      st.pos[0] = -rApo / 2;
      st.pos[3] = rApo / 2;
      st.vel[1] = -vApo / 2;
      st.vel[4] = vApo / 2;
      return st;
    };
    const period = 2 * Math.PI * Math.sqrt(KEPLER.a ** 3 / (KEPLER.G * 2 * KEPLER.m));
    const STEPS_PER_ORBIT = 400;
    const ORBITS = 20;

    const sFixed = eccentric(0.9);
    const fFixed = force();
    const fsi = createFsi4(sFixed, fFixed, { maxStep: period / STEPS_PER_ORBIT });
    const fsiPeak = peakDrift(
      () => fsi.step(period / STEPS_PER_ORBIT),
      () => fsi.energy().total,
      STEPS_PER_ORBIT * ORBITS,
    );

    const sLog = eccentric(0.9);
    const lf = createLogH(sLog, force(), { maxStep: period / STEPS_PER_ORBIT });
    const e0 = lf.energy().total;
    let logPeak = 0;
    while (lf.t < ORBITS * period) {
      lf.step(period / STEPS_PER_ORBIT);
      logPeak = Math.max(logPeak, Math.abs((lf.energy().total - e0) / e0));
    }

    /* Asserted as a RATIO rather than an absolute, so the test says "the time transformation
       is doing its job" rather than pinning a number that a tolerance change would break. */
    expect(logPeak).toBeLessThan(fsiPeak);
  });

  it("refuses a TIME-DEPENDENT potential rather than silently solving nothing", () => {
    /*
     * The reachable wrong pairing: `gasExpulsion/` has an explicitly time-varying potential and
     * runs on a model that supplies everything this constructor otherwise needs. Every step
     * would still be arithmetically valid, and the scheme would report a beautifully bounded
     * error for a trajectory that is not a solution — the exact silent-wrongness this codebase
     * keeps designing against, so it must be an error and not a caveat in a docstring.
     */
    const base = createDirectForce({ G: KEPLER.G, softening: KEPLER.softening });
    const drifting = {
      ...base,
      id: "drifting-test-model",
      // Same shape as gasExpulsion's `(r, t) => gasMassAt(t) * phiGasUnit[...]`.
      potentialEnergy: (p: Float64Array, m: Float64Array, t: number) =>
        base.potentialEnergy(p, m, t) * (1 + 0.1 * t),
    };
    expect(() => createLogH(keplerPair(), drifting)).toThrow(/TIME-INDEPENDENT/);
  });

  it("refuses a configuration it cannot transform, rather than producing NaN", () => {
    const lone = createState(1);
    lone.mass[0] = 1;
    // -U = 0 for a single particle: ln(V) is undefined and every step would silently NaN.
    expect(() => createLogH(lone, force())).toThrow(/self-gravitating/);
  });
});
