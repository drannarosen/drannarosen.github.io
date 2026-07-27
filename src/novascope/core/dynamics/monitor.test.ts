/*
 * monitor.test.ts — does the watchdog actually bark?
 *
 * The failure mode for a health monitor is silence: it reports green because its threshold is
 * loose, its normalization divides by something near zero, or it only ever sees good runs. So
 * the load-bearing tests here are the ones that feed it a KNOWN-BAD integration and require it
 * to notice.
 */
import { describe, expect, it } from "vitest";
import { createConservationMonitor } from "./monitor.ts";
import { createLeapfrog } from "./integrate.ts";
import { createDirectForce, softeningForCluster, DIRECT_STEPS_PER_TCROSS } from "./direct/index.ts";
import { createMeanFieldForce } from "./meanField/index.ts";
import { clusterState } from "./ic.ts";
import { crossingTime } from "./diagnostics.ts";
import { defaultIdentity } from "../cluster/params.ts";
import type { State } from "./types.ts";

const N = 300;
const SCALE_PC = 0.5;

function cluster(seed: number): State {
  return clusterState(
    defaultIdentity({
      seed,
      sampling: { mode: "count", target: N },
      profile: { kind: "plummer", scaleRadius: SCALE_PC },
      kinematics: { virialRatio: 0.5 },
    }),
    createDirectForce({ softening: softeningForCluster(SCALE_PC * 1.305, N) }),
  );
}

const directForce = (): ReturnType<typeof createDirectForce> =>
  createDirectForce({ softening: softeningForCluster(SCALE_PC * 1.305, N) });

describe("createConservationMonitor", () => {
  it("reports a healthy run at the measured step density", () => {
    const s = cluster(2026);
    const force = directForce();
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });
    const monitor = createConservationMonitor(lf);

    for (let i = 0; i < 10; i++) {
      lf.step(tCross);
      monitor.sample();
    }

    expect(monitor.healthy).toBe(true);
    expect(monitor.worst.energy).toBeLessThan(1e-3);
    expect(monitor.latest?.tCross).toBeCloseTo(10, 6);
    expect(monitor.history.length).toBe(10);
  });

  it("TEETH: catches a deliberately under-resolved run", () => {
    /* The whole point. Eight steps per crossing time drifts by 5e-2..3e-1 (measured in the
       convergence study), so a monitor that stays green here is not monitoring anything. */
    const s = cluster(2026);
    const force = directForce();
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / 8 });
    const monitor = createConservationMonitor(lf);

    for (let i = 0; i < 10; i++) {
      lf.step(tCross);
      monitor.sample();
    }

    expect(monitor.healthy).toBe(false);
    expect(monitor.worst.energy).toBeGreaterThan(1e-3);
  });

  it("LATCHES: a run that recovers is still reported unhealthy", () => {
    /* A trajectory that diverged and came back is not the same trajectory. Treating a
       momentary breach as noise is precisely the mistake this is written against, so
       `healthy` never returns to true without an explicit rebase. */
    const s = cluster(2026);
    const force = directForce();
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / 8 });
    const monitor = createConservationMonitor(lf, { energyTolerance: 1e-6 });

    lf.step(tCross);
    monitor.sample();
    expect(monitor.healthy).toBe(false);

    // Even if a later sample happens to sit closer to E0, health does not come back.
    for (let i = 0; i < 20; i++) {
      lf.step(tCross / 10);
      monitor.sample();
    }
    expect(monitor.healthy).toBe(false);

    monitor.rebase();
    expect(monitor.healthy).toBe(true); // …only an explicit rebase clears it
    expect(monitor.worst.energy).toBe(0);
    expect(monitor.history.length).toBe(0);
  });

  it("normalizes momentum against a PHYSICAL scale, not against p0 ~ 0", () => {
    /* `removeBulkMotion` leaves |p0| at round-off, so |dp|/|p0| would divide noise by noise.
       The check: a well-behaved direct run reports a momentum drift that is small — which it
       can only do if the denominator is the cluster's own M*v_rms rather than |p0|. */
    const s = cluster(7);
    const force = directForce();
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });
    const monitor = createConservationMonitor(lf);

    for (let i = 0; i < 5; i++) {
      lf.step(tCross);
      monitor.sample();
    }
    // direct/ applies each pair to both members, so momentum is conserved to round-off.
    expect(monitor.worst.momentum).toBeLessThan(1e-9);
    expect(Number.isFinite(monitor.worst.momentum)).toBe(true);
    expect(monitor.worst.angular).toBeLessThan(1e-6);
  });

  it("CORRECTLY flags a mean-field run on fresh ICs — its energy is not trustworthy there", () => {
    /* This test originally asserted the opposite, on the assumption that flagging meanField
     * would be crying wolf. Measuring settled it. Energy drift over five crossing times, at
     * four step densities, three seeds:
     *
     *      32 steps:  3.81e+0   6.23e-2   5.11e-2
     *     128 steps:  3.62e-1   4.06e-2   3.37e-2
     *     512 steps:  2.23e-1   5.51e-2   3.52e-2
     *    2048 steps:  4.40e-1   6.53e-2   3.45e-2
     *
     * It does not converge. Sixty-four times more steps changes nothing, because the error is
     * SPATIAL — a binned M(<r) is not the gradient of the binned potential, as `meanField/`'s
     * own header states — and no timestep removes it. direct/ on the same runs sits at
     * 5e-6..3e-5, four orders better.
     *
     * So the warning is real, not a false alarm: on a freshly sampled cluster, which is not an
     * equilibrium configuration and therefore rearranges, this model's energy cannot be
     * trusted. `../gasExpulsion/` gets away with it only by virial-scaling AND settling for
     * thirty crossing times first. The lab must surface this rather than hide it.
     */
    const s = cluster(2026);
    const force = createMeanFieldForce(s.n, { rMin: 1e-3, rMax: 100 });
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });
    const monitor = createConservationMonitor(lf);

    for (let i = 0; i < 5; i++) {
      lf.step(tCross);
      monitor.sample();
    }
    expect(monitor.healthy).toBe(false);
    expect(monitor.worst.energy).toBeGreaterThan(1e-2);
  });

  it("…and the fix is SOFTENING, not a smaller timestep", () => {
    /* The obvious response to a drifting run is a finer step. Measured, that does nothing
       here: 2048 steps per crossing time is no better than 128. Nor do more bins. What works
       is matching the softening to the cluster — eps ~ r_h/N^(1/3), the mean interparticle
       separation, which for this cluster is 0.098 pc against the 0.02 pc default calibrated
       for gasExpulsion's much denser one. Measured 3.6e-1 -> 3.9e-2 on this seed. */
    const s = cluster(2026);
    const force = createMeanFieldForce(s.n, {
      rMin: 1e-3,
      rMax: 100,
      softening: softeningForCluster(SCALE_PC * 1.305, N),
    });
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });
    const monitor = createConservationMonitor(lf, { energyTolerance: 0.1 });
    for (let i = 0; i < 5; i++) {
      lf.step(tCross);
      monitor.sample();
    }
    // An order of magnitude better than the same run at the default softening (3.6e-1).
    expect(monitor.worst.energy).toBeLessThan(0.1);
  });

  it("takes a caller-supplied tolerance, because the right one is per force model", () => {
    /* direct/ at 128 steps drifts 5e-6..3e-5; meanField carries an irreducible few percent.
       One universal number cannot serve both, so the caller — which knows which model it is
       running — sets it. The default is direct-grade. */
    const s = cluster(555);
    const force = createMeanFieldForce(s.n, { rMin: 1e-3, rMax: 100 });
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });
    const monitor = createConservationMonitor(lf, { energyTolerance: 0.1 });

    for (let i = 0; i < 5; i++) {
      lf.step(tCross);
      monitor.sample();
    }
    // Seed 555 measures 3.4e-2, inside a mean-field-appropriate 0.1.
    expect(monitor.healthy).toBe(true);
    expect(monitor.worst.energy).toBeGreaterThan(1e-3); // and would fail the direct-grade one
  });

  it("still MEASURES momentum drift, which meanField cannot conserve", () => {
    /* Reported but never gated: meanField's force is defined about a fixed origin, so it has
       no reason to conserve linear momentum, while a direct/ run whose momentum moves is
       genuinely broken. Health is judged on energy alone so this distinction stays visible
       rather than being collapsed into one verdict. */
    const s = cluster(2026);
    const force = createMeanFieldForce(s.n, { rMin: 1e-3, rMax: 100 });
    const lf = createLeapfrog(s, force, { maxStep: crossingTime(s) / DIRECT_STEPS_PER_TCROSS });
    const monitor = createConservationMonitor(lf);
    lf.step(crossingTime(s));
    const sample = monitor.sample();
    expect(Number.isFinite(sample.momentumDrift)).toBe(true);
    expect(sample.momentumDrift).toBeGreaterThanOrEqual(0);
  });

  it("counts time in crossing times of the initial configuration", () => {
    const s = cluster(555);
    const force = directForce();
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / DIRECT_STEPS_PER_TCROSS });
    const monitor = createConservationMonitor(lf);

    lf.step(tCross * 2.5);
    const sample = monitor.sample();
    expect(sample.tCross).toBeCloseTo(2.5, 6);
    expect(sample.t).toBeCloseTo(tCross * 2.5, 9);
    // Myr and crossing times are different numbers — the clock conversion is real.
    expect(sample.t).not.toBeCloseTo(sample.tCross, 3);
  });

  it("caps its history so a long run cannot grow without bound", () => {
    const s = cluster(11);
    const force = directForce();
    const tCross = crossingTime(s);
    const lf = createLeapfrog(s, force, { maxStep: tCross / 16 });
    const monitor = createConservationMonitor(lf, { historyLimit: 5 });

    for (let i = 0; i < 20; i++) {
      lf.step(tCross / 8);
      monitor.sample();
    }
    expect(monitor.history.length).toBe(5);
    // Oldest first, and it is the RECENT five that survive.
    expect(monitor.history[4].t).toBeCloseTo(lf.t, 9);
    expect(monitor.history[0].t).toBeLessThan(monitor.history[4].t);
  });

  it("reports a virial ratio that starts at the value the ICs were built for", () => {
    const s = cluster(2026);
    const force = directForce();
    const lf = createLeapfrog(s, force, { maxStep: crossingTime(s) / DIRECT_STEPS_PER_TCROSS });
    const monitor = createConservationMonitor(lf);
    expect(monitor.sample().virialRatio).toBeCloseTo(0.5, 6);
  });
});
