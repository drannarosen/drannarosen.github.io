/*
 * ic.test.ts — initial conditions, and the units boundary that lives in them.
 *
 * The tests that matter here are the ones about CONVENTIONS rather than about physics:
 * km/s against pc/Myr, and Q measured against the same force model that will step the
 * system. Both are the kind of error that produces a plausible number.
 */
import { describe, expect, it } from "vitest";
import {
  clusterState,
  combineStates,
  drawMaxwellian,
  kineticEnergy,
  removeBulkMotion,
  scaleToVirial,
  toLatent,
  toState,
} from "./ic.ts";
import { createDirectForce } from "./direct/index.ts";
import { createState } from "./types.ts";
import { KM_S_TO_PC_MYR } from "../constants/index.ts";
import { defaultIdentity } from "../cluster/params.ts";
import { mulberry32 } from "../random/index.ts";
import { measure } from "./diagnostics.ts";

const G = 1;

describe("unit conversion at the LatentStar boundary", () => {
  it("converts km/s to pc/Myr going in, and back going out", () => {
    const stars = [{ id: 0, mass: 1, Z: 0.014, x: 1, y: 2, z: 3, vx: 10, vy: -5, vz: 0.5 }];
    const s = toState(stars);
    // The whole point: 10 km/s is NOT 10 pc/Myr, and the factor is not 1.
    expect(s.vel[0]).toBeCloseTo(10 * KM_S_TO_PC_MYR, 12);
    expect(s.vel[0]).not.toBeCloseTo(10, 3);
    expect(KM_S_TO_PC_MYR).toBeGreaterThan(1.02);
    expect(KM_S_TO_PC_MYR).toBeLessThan(1.03);

    // Round trip must be exact, or an evolved cluster silently rescales every time it is
    // written back and re-read.
    const back = structuredClone(stars);
    toLatent(s, back);
    expect(back[0].vx).toBeCloseTo(10, 12);
    expect(back[0].vy).toBeCloseTo(-5, 12);
    expect(back[0].x).toBeCloseTo(1, 12);
  });
});

describe("removeBulkMotion", () => {
  it("zeroes both the centre of mass and the net momentum", () => {
    const s = createState(4);
    for (let i = 0; i < 4; i++) {
      s.mass[i] = 1 + i;
      s.pos[i * 3] = 10 + i;
      s.pos[i * 3 + 1] = -3;
      s.vel[i * 3] = 5;
      s.vel[i * 3 + 2] = i;
    }
    removeBulkMotion(s);
    let mTot = 0;
    const com = [0, 0, 0];
    const mom = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
      mTot += s.mass[i];
      for (let k = 0; k < 3; k++) {
        com[k] += s.mass[i] * s.pos[i * 3 + k];
        mom[k] += s.mass[i] * s.vel[i * 3 + k];
      }
    }
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(com[k] / mTot)).toBeLessThan(1e-12);
      expect(Math.abs(mom[k] / mTot)).toBeLessThan(1e-12);
    }
  });
});

describe("scaleToVirial", () => {
  it("lands on the requested Q, measured with the force model that will step it", () => {
    const s = createState(50);
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      s.mass[i] = 1;
      for (let k = 0; k < 3; k++) s.pos[i * 3 + k] = (rng() - 0.5) * 4;
    }
    drawMaxwellian(s, rng);
    removeBulkMotion(s);

    const force = createDirectForce({ softening: 0.05, G });
    scaleToVirial(s, force, 0.5);
    const u = force.potentialEnergy(s.pos, s.mass, 0);
    expect(kineticEnergy(s) / Math.abs(u)).toBeCloseTo(0.5, 10);

    // And an explicitly non-equilibrium target must be honoured, not silently normalised.
    scaleToVirial(s, force, 0.1);
    expect(kineticEnergy(s) / Math.abs(force.potentialEnergy(s.pos, s.mass, 0))).toBeCloseTo(
      0.1,
      10,
    );
  });
});

describe("drawMaxwellian", () => {
  it("is isotropic and reproducible from a seed", () => {
    const a = createState(4000);
    const b = createState(4000);
    drawMaxwellian(a, mulberry32(42));
    drawMaxwellian(b, mulberry32(42));
    expect(Array.from(a.vel.slice(0, 20))).toEqual(Array.from(b.vel.slice(0, 20)));

    // No preferred axis: the three dispersions must agree to sampling error ~1/sqrt(2N).
    const var3 = [0, 1, 2].map((k) => {
      let s = 0;
      for (let i = 0; i < a.n; i++) s += a.vel[i * 3 + k] ** 2;
      return s / a.n;
    });
    const mean = (var3[0] + var3[1] + var3[2]) / 3;
    // 1/sqrt(2N) = 1.1% at N = 4000; 5% is the threshold, generous but not vacuous.
    for (const v of var3) expect(Math.abs(v / mean - 1)).toBeLessThan(0.05);
    expect(mean).toBeCloseTo(1, 1); // unit dispersion before scaling
  });
});

describe("clusterState", () => {
  it("builds an integrable cluster from a ClusterIdentity at the identity's Q", () => {
    const id = defaultIdentity({
      seed: 2026,
      sampling: { mode: "count", target: 300 },
      profile: { kind: "plummer", scaleRadius: 1 },
      kinematics: { virialRatio: 0.5 },
    });
    const force = createDirectForce({ softening: 0.02, G });
    const s = clusterState(id, force);

    expect(s.n).toBe(300);
    const d = measure(s, force);
    expect(d.virialRatio).toBeCloseTo(0.5, 8);
    // A virialized cluster is mostly bound; this is a sanity floor, not a physics claim.
    expect(d.boundMassFraction).toBeGreaterThan(0.5);
    expect(d.halfMassRadius).toBeGreaterThan(0);

    // Same seed, same cluster — ADR 0012's "one canonical cluster = (seed, params, t)".
    const again = clusterState(id, createDirectForce({ softening: 0.02, G }));
    expect(Array.from(again.pos.slice(0, 12))).toEqual(Array.from(s.pos.slice(0, 12)));
    expect(Array.from(again.vel.slice(0, 12))).toEqual(Array.from(s.vel.slice(0, 12)));
  });

  it("honours an explicit virialRatio over the identity's", () => {
    const id = defaultIdentity({
      seed: 5,
      sampling: { mode: "count", target: 200 },
      kinematics: { virialRatio: 0.5 },
    });
    const force = createDirectForce({ softening: 0.02, G });
    const s = clusterState(id, force, { virialRatio: 0.2 });
    expect(measure(s, force).virialRatio).toBeCloseTo(0.2, 8);
  });
});

describe("combineStates", () => {
  it("places two clumps with their own offsets and bulk velocities", () => {
    const one = createState(2);
    one.mass[0] = 1;
    one.mass[1] = 2;
    one.vel[0] = 0.5;
    const two = createState(1);
    two.mass[0] = 3;

    const merged = combineStates([
      { state: one, place: { offset: [-5, 0, 0], velocity: [1, 0, 0] } },
      { state: two, place: { offset: [5, 0, 0], velocity: [-1, 0, 0] } },
    ]);

    expect(merged.n).toBe(3);
    expect(merged.pos[0]).toBeCloseTo(-5, 12);
    expect(merged.vel[0]).toBeCloseTo(1.5, 12); // own 0.5 plus the clump's 1
    expect(merged.pos[6]).toBeCloseTo(5, 12);
    expect(merged.vel[6]).toBeCloseTo(-1, 12);
    expect(Array.from(merged.mass)).toEqual([1, 2, 3]);
  });
});
