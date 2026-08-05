/*
 * symmetric.test.ts — the three claims that justify a fourth integrator existing.
 *
 * Not "does it run". `hermite.ts` already runs and is already fourth order. This scheme earns
 * its place only if it does two things the asymmetric one cannot, so those are the tests:
 *
 *   1. TIME-REVERSAL. Step forward, negate the velocities, step back the same number of steps.
 *      A time-symmetric map returns to its start; an asymmetric one does not. This is the
 *      property, and every other benefit is downstream of it.
 *   2. BOUNDED, NOT SECULAR, ENERGY ERROR over a long run. This is what the drift measurement
 *      on /dynamics-lab was actually complaining about: our Hermite gets WORSE the harder it
 *      works, because its error accumulates with step count.
 *   3. FOURTH ORDER, so the corrector is right rather than merely stable.
 *
 * Plus the trap gravax records at `hermite/symmetric/kinematics.py`: the step criterion must be
 * a pure STATE FUNCTION. Their earlier version built h from interpolated derivatives, which
 * depend on the previous state and on dt, and the "symmetric" scheme then drifted MORE than the
 * asymmetric baseline. Test 2 is what would catch that regression here.
 */
import { describe, expect, it } from "vitest";
import { createDirectForce } from "./direct/index.ts";
import { createHermite } from "./hermite.ts";
import { createSymmetricHermite } from "./symmetric.ts";
import { KEPLER, KEPLER_PERIOD, keplerPair } from "./kepler.testutil.ts";
import type { State } from "./types.ts";

/* `softening: number` explicitly: KEPLER is `as const`, so inferring the parameter type from
   the default would narrow it to the literal 0.00001 and the zero-softening test below could
   not pass its own argument. */
const keplerForce = (softening: number = KEPLER.softening) =>
  createDirectForce({ softening, G: KEPLER.G });

const clone = (s: State): State => ({
  n: s.n,
  mass: Float64Array.from(s.mass),
  pos: Float64Array.from(s.pos),
  vel: Float64Array.from(s.vel),
});

/** Peak |dE/E0| sampled every step over `periods` orbits at a fixed step. */
function peakDrift(
  make: (s: State, f: ReturnType<typeof keplerForce>, dt: number) => { step(dt: number): void; energy(): { total: number } },
  stepsPerPeriod: number,
  periods: number,
  softening: number = KEPLER.softening, // `number`, not the inferred literal — see keplerForce
): number {
  const s = keplerPair();
  const force = keplerForce(softening);
  const dt = KEPLER_PERIOD / stepsPerPeriod;
  const integ = make(s, force, dt);
  const e0 = integ.energy().total;
  let peak = 0;
  for (let i = 0; i < stepsPerPeriod * periods; i++) {
    integ.step(dt);
    peak = Math.max(peak, Math.abs((integ.energy().total - e0) / e0));
  }
  return peak;
}

describe("symmetric Hermite — time reversal", () => {
  it("returns to its starting state when the velocities are negated and it is run back", () => {
    const s = keplerPair();
    const start = clone(s);
    const force = keplerForce();
    const dt = KEPLER_PERIOD / 256;
    const n = 256;

    const fwd = createSymmetricHermite(s, force, { maxStep: dt });
    for (let i = 0; i < n; i++) fwd.step(dt);

    // Negate velocities: the same map run forward now retraces the trajectory.
    for (let i = 0; i < s.vel.length; i++) s.vel[i] = -s.vel[i];
    const back = createSymmetricHermite(s, force, { maxStep: dt });
    for (let i = 0; i < n; i++) back.step(dt);

    let worstPos = 0;
    for (let i = 0; i < s.pos.length; i++) {
      worstPos = Math.max(worstPos, Math.abs(s.pos[i] - start.pos[i]));
    }
    /* Not machine epsilon: the corrector is iterated to a finite fixed point, so the return is
       exact only to that residual. 1e-9 on an orbit of size 1 is four orders below the
       asymmetric scheme's return error, which is the discrimination being asserted. */
    expect(worstPos).toBeLessThan(1e-9);
  });

  it("returns MORE closely than the asymmetric Hermite on the same orbit and step", () => {
    const dt = KEPLER_PERIOD / 256;
    const n = 256;

    const roundTrip = (make: (s: State, f: ReturnType<typeof keplerForce>) => { step(dt: number): void }): number => {
      const s = keplerPair();
      const start = clone(s);
      const force = keplerForce();
      const fwd = make(s, force);
      for (let i = 0; i < n; i++) fwd.step(dt);
      for (let i = 0; i < s.vel.length; i++) s.vel[i] = -s.vel[i];
      const back = make(s, force);
      for (let i = 0; i < n; i++) back.step(dt);
      let worst = 0;
      for (let i = 0; i < s.pos.length; i++) worst = Math.max(worst, Math.abs(s.pos[i] - start.pos[i]));
      return worst;
    };

    const sym = roundTrip((s, f) => createSymmetricHermite(s, f, { maxStep: dt }));
    const asym = roundTrip((s, f) => createHermite(s, f, { maxStep: dt }));
    expect(sym).toBeLessThan(asym);
  });
});

describe("symmetric Hermite — the energy error is bounded, not secular", () => {
  it("grows far more slowly than the asymmetric scheme over a long run", () => {
    const steps = 128;
    const symShort = peakDrift((s, f, dt) => createSymmetricHermite(s, f, { maxStep: dt }), steps, 4);
    const symLong = peakDrift((s, f, dt) => createSymmetricHermite(s, f, { maxStep: dt }), steps, 64);
    const asymShort = peakDrift((s, f, dt) => createHermite(s, f, { maxStep: dt }), steps, 4);
    const asymLong = peakDrift((s, f, dt) => createHermite(s, f, { maxStep: dt }), steps, 64);

    /* The DISCRIMINATOR is how much each degrades with 16x the steps, not the absolute value.
       A secular error grows with step count; a bounded one does not. Comparing growth factors
       rather than magnitudes is what makes this a test of symmetry and not of accuracy. */
    const symGrowth = symLong / symShort;
    const asymGrowth = asymLong / asymShort;
    expect(symGrowth).toBeLessThan(asymGrowth);
    expect(symGrowth).toBeLessThan(4);
  });
});

describe("symmetric Hermite — order", () => {
  it("is fourth order on the eccentric fixture", () => {
    const drifts = [256, 512, 1024, 2048].map((n) =>
      peakDrift((s, f, dt) => createSymmetricHermite(s, f, { maxStep: dt }), n, 4),
    );
    const ratios = drifts.slice(0, -1).map((d, i) => d / drifts[i + 1]);
    // Fourth order is 16 per halving. Generous window: this is an order check, not a fit.
    for (const r of ratios) expect(r).toBeGreaterThan(8);
  });
});

describe("symmetric Hermite — needs no softening", () => {
  it("integrates the eccentric pair at exactly zero softening", () => {
    const peak = peakDrift(
      (s, f, dt) => createSymmetricHermite(s, f, { maxStep: dt }),
      512,
      4,
      0,
    );
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeLessThan(1e-6);
  });
});

describe("symmetric Hermite — adaptive step is a state function", () => {
  it("advises a step that depends only on the state, not on how it was reached", () => {
    const force = keplerForce();
    const a = keplerPair();
    const b = keplerPair();
    // Reach the same state by two different step histories.
    const ia = createSymmetricHermite(a, force, { maxStep: KEPLER_PERIOD / 512, adaptive: true });
    const ib = createSymmetricHermite(b, force, { maxStep: KEPLER_PERIOD / 128, adaptive: true });
    ia.step(KEPLER_PERIOD / 64);
    ib.step(KEPLER_PERIOD / 64);
    /* Both are at t = P/64 but arrived by different sub-step sequences. The CRITERION is a pure
       function of the state, so evaluating it on a state produced by either path must agree to
       the accuracy the two paths agree on the state itself — it must not carry history. */
    const ha = ia.advisedStep();
    const hb = ib.advisedStep();
    expect(Math.abs(ha - hb) / ha).toBeLessThan(1e-3);
  });
});
