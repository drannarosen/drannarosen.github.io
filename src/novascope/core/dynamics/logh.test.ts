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
import { kineticEnergy } from "./quantities.ts";
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

  /*
   * ORDER, MEASURED ON THE LOCAL ERROR — and it has to be local, for two reasons that both
   * bit while writing this.
   *
   * Kepler cannot test the order at all: LogH integrates its energy EXACTLY, so every step
   * size reports 1e-15 and the "convergence study" is a study of round-off. And a global
   * error study on a three-body system measures CHAOS — a different h means a different
   * trajectory and different close encounters, so comparing |dE/E| across h compares two
   * different solutions. That produced apparent ratios of 652x and 1668x, i.e. "order 10".
   *
   * One step against a converged reference over the same fictitious interval cannot diverge,
   * so the slope is the scheme's. Local error ~ h^(p+1), so the halving ratio is 2^(p+1).
   */
  it("is second or fourth order in the fictitious step, as its `order` says", () => {
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
    const advance = (order: 2 | 4, H: number, n: number) => {
      const s = threeBody();
      const lf = createLogH(s, f(), { order });
      for (let i = 0; i < n; i++) lf.stepFictitious(H / n);
      return { pos: Array.from(s.pos), t: lf.t };
    };
    const localError = (order: 2 | 4, H: number) => {
      const one = advance(order, H, 1);
      const ref = advance(order, H, 2048);
      return Math.max(
        ...one.pos.map((v, i) => Math.abs(v - ref.pos[i])),
        Math.abs(one.t - ref.t),
      );
    };
    for (const [order, expected] of [
      [2, 2],
      [4, 4],
    ] as const) {
      const coarse = localError(order, 0.1);
      const fine = localError(order, 0.05);
      const p = Math.log2(coarse / fine) - 1;
      // Generous window: this must catch "the composition is broken", not police a decimal.
      expect(p).toBeGreaterThan(expected - 0.5);
      expect(p).toBeLessThan(expected + 0.7);
    }
  });

  it("is time-reversible: run it backwards and the state returns", () => {
    /* A symmetric composition of exact maps must undo itself. This is what breaks first if a
       sub-map is not actually exact, or if the Yoshida weights are mis-ordered — both of which
       still produce a plausible-looking orbit. */
    const s = keplerPair();
    const lf = createLogH(s, force(), { order: 4 });
    const p0 = Array.from(s.pos);
    const v0 = Array.from(s.vel);
    for (let i = 0; i < 300; i++) lf.stepFictitious(0.02);
    for (let i = 0; i < 300; i++) lf.stepFictitious(-0.02);
    expect(Math.max(...s.pos.map((v, i) => Math.abs(v - p0[i])))).toBeLessThan(1e-12);
    expect(Math.max(...s.vel.map((v, i) => Math.abs(v - v0[i])))).toBeLessThan(1e-12);
    expect(Math.abs(lf.t)).toBeLessThan(1e-12);
  });

  it("holds the identity the whole derivation rests on: T + w = -U", () => {
    /* w is set once to -E0 and never touched, so this is the statement that the trajectory
       stays on the physical manifold Gamma = 0. If it drifted, `dt = h/(T+w)` in the drift and
       `h/(-U)` in the kick would be dividing by two different numbers and the scheme would
       silently stop being the method it claims to be. */
    const s = keplerPair();
    const f = force();
    const lf = createLogH(s, f, { order: 4 });
    const w = -(kineticEnergy(s) + f.potentialEnergy(s.pos, s.mass, 0));
    let worst = 0;
    for (let i = 0; i < 500; i++) {
      lf.stepFictitious(0.02);
      const lhs = kineticEnergy(s) + w;
      const rhs = -f.potentialEnergy(s.pos, s.mass, lf.t);
      worst = Math.max(worst, Math.abs(lhs - rhs) / Math.abs(rhs));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("reports the WHOLE step in lastPhysicalStep, not a Yoshida sub-step", () => {
    /* It used to be assigned inside `drift`, so it returned a half-drift scaled by a Yoshida
       weight — and the middle weight is negative, so it could report a negative "step". It is
       the diagnostic that answers "is this adapting?", so it has to mean what it says. */
    const s = keplerPair();
    const lf = createLogH(s, force(), { order: 4 });
    const before = lf.t;
    lf.stepFictitious(0.02);
    expect(lf.lastPhysicalStep).toBeGreaterThan(0);
    expect(lf.lastPhysicalStep).toBeCloseTo(lf.t - before, 15);
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
