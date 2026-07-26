/*
 * meanField.test.ts — what is actually true of a spherically-averaged force.
 *
 * This file deliberately does NOT contain the gradient contract test that `../direct/` has.
 * M(<r) is a step function, so the binned force is not the exact gradient of the binned
 * potential and cannot be made so by loosening a tolerance. Testing a weakened version of
 * the wrong property would read as coverage while proving nothing. What IS true — exact
 * radiality, exact per-star angular momentum, and agreement with `direct` in the global
 * quantities where discreteness averages out — is tested instead.
 *
 * THE CROSS-CHECK IS THE INTERESTING ONE, and it asserts that the two models DIFFER by about
 * the right amount rather than that they agree. They are different equations (ADR 0016); a
 * test showing them agreeing closely per star would mean one of them was wrong.
 */
import { describe, expect, it } from "vitest";
import { createMeanFieldForce } from "./index.ts";
import { createDirectForce } from "../direct/index.ts";
import { createLeapfrog } from "../integrate.ts";
import { createState, type State } from "../types.ts";
import { samplePlummer } from "../../cluster/profiles.ts";
import { mulberry32 } from "../../random/index.ts";

const G = 1;
const A = 1; // Plummer scale radius, test units

function plummer(n: number, seed = 12345): State {
  const rng = mulberry32(seed);
  const s = createState(n);
  for (let i = 0; i < n; i++) {
    s.mass[i] = 1 / n;
    const [x, y, z] = samplePlummer(rng(), rng, A);
    s.pos[i * 3] = x;
    s.pos[i * 3 + 1] = y;
    s.pos[i * 3 + 2] = z;
  }
  return s;
}

/** Median per-star relative difference in RADIAL acceleration, over the well-sampled shell. */
function radialScatter(n: number): number {
  const s = plummer(n);
  const eps = 0.01 * A;
  const d = createDirectForce({ softening: eps, G });
  const m = createMeanFieldForce(n, { G, softening: eps, rMin: 1e-3, rMax: 100 });
  const ad = new Float64Array(n * 3);
  const am = new Float64Array(n * 3);
  d.accelerations(s.pos, s.mass, ad, 0);
  m.accelerations(s.pos, s.mass, am, 0);

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]);
    if (r < 0.2 * A || r > 3 * A) continue; // skip the sparse core and the far tail
    const radial = (v: Float64Array): number =>
      (v[i * 3] * s.pos[i * 3] + v[i * 3 + 1] * s.pos[i * 3 + 1] + v[i * 3 + 2] * s.pos[i * 3 + 2]) /
      r;
    const rm = radial(am);
    if (rm !== 0) out.push(Math.abs(radial(ad) / rm - 1));
  }
  out.sort((x, y) => x - y);
  return out[Math.floor(out.length / 2)];
}

describe("createMeanFieldForce", () => {
  it("produces a strictly RADIAL force — there is no torque in this model at all", () => {
    const n = 400;
    const s = plummer(n);
    const m = createMeanFieldForce(n, { G, rMin: 1e-3, rMax: 100 });
    const acc = new Float64Array(n * 3);
    m.accelerations(s.pos, s.mass, acc, 0);

    for (let i = 0; i < n; i++) {
      // a x r must vanish identically: the acceleration is f * position by construction.
      const [x, y, z] = [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]];
      const [ax, ay, az] = [acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]];
      const cross = Math.hypot(y * az - z * ay, z * ax - x * az, x * ay - y * ax);
      const scale = Math.hypot(ax, ay, az) * Math.hypot(x, y, z);
      expect(cross).toBeLessThan(1e-15 * (1 + scale));
    }
  });

  it("conserves EVERY star's angular momentum, not merely the total", () => {
    /* The signature of a central force, and the crispest way to tell the two models apart:
       `direct` conserves only the TOTAL (stars exchange angular momentum through pair
       torques), while here each star's own L is a constant of motion. */
    const n = 300;
    const s = plummer(n);
    const rng = mulberry32(999);
    for (let i = 0; i < n * 3; i++) s.vel[i] = (rng() - 0.5) * 0.4;

    const m = createMeanFieldForce(n, { G, rMin: 1e-3, rMax: 100 });
    const lOf = (i: number): [number, number, number] => {
      const [x, y, z] = [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]];
      const [vx, vy, vz] = [s.vel[i * 3], s.vel[i * 3 + 1], s.vel[i * 3 + 2]];
      return [y * vz - z * vy, z * vx - x * vz, x * vy - y * vx];
    };
    const before = Array.from({ length: n }, (_, i) => lOf(i));
    const lf = createLeapfrog(s, m, { maxStep: 0.002 });
    for (let i = 0; i < 500; i++) lf.step(0.002);

    for (let i = 0; i < n; i++) {
      const after = lOf(i);
      const mag = Math.hypot(...before[i]);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(after[k] - before[i][k])).toBeLessThan(1e-9 * (1 + mag));
      }
    }
  });

  it("agrees with `direct` on TOTAL potential energy, where discreteness averages out", () => {
    const n = 2000;
    const s = plummer(n);
    const eps = 0.01 * A;
    const uDirect = createDirectForce({ softening: eps, G }).potentialEnergy(s.pos, s.mass, 0);
    const uMean = createMeanFieldForce(n, { G, softening: eps, rMin: 1e-3, rMax: 100 })
      .potentialEnergy(s.pos, s.mass, 0);
    /* Measured 2026-07-26: ratio 1.0085 at n = 2000, and inside [0.995, 1.009] across
       n = 200..4000. Bound at 5% — well above that, and tight enough that a factor-of-two
       error in either shell sum (the 1/2 on the self-energy, say) could not pass. */
    expect(Math.abs(uDirect / uMean - 1)).toBeLessThan(0.05);
  });

  it("differs from `direct` PER STAR by the discreteness noise, which shrinks as N^(-1/3)", () => {
    /* THE PHYSICS, asserted as a lower bound as well as an upper one.
     *
     * Per-star, the two models disagree by several percent, and that gap is not an error in
     * either: it is the fluctuating force from a star's nearest neighbours, which is exactly
     * what a mean field averages away. The nearest neighbour dominates it, so it scales as
     * the mean interparticle spacing — N^(-1/3), the Holtsmark result — and NOT as N^(-1/2),
     * which is what a bin-statistics argument would wrongly predict. That prediction was in
     * the design document until this test measured it.
     *
     * Measured 2026-07-26: median 0.1012 / 0.0710 / 0.0472 at n = 200 / 1000 / 4000. A 20x
     * increase in n shrinks the scatter 2.15x, against 2.71x for a pure N^(-1/3) law and
     * 4.47x for N^(-1/2).
     */
    const small = radialScatter(500);
    const large = radialScatter(4000);

    // It must be REAL: if these agreed closely, one of the two models would be wrong.
    expect(small).toBeGreaterThan(0.01);
    // …and it must CONVERGE: more particles means a better-sampled mean field.
    expect(large).toBeLessThan(small);
    // The 8x in n predicts ~2x under N^(-1/3); bound loosely, since it is a scaling law.
    expect(small / large).toBeGreaterThan(1.2);
    expect(small / large).toBeLessThan(4);
  });

  it("adds an external spherical background to the force and to the energy", () => {
    const n = 100;
    const s = plummer(n);
    const bare = createMeanFieldForce(n, { G, rMin: 1e-3, rMax: 100 });
    const withGas = createMeanFieldForce(n, {
      G,
      rMin: 1e-3,
      rMax: 100,
      external: { enclosedMass: () => 5, potential: (r) => -G * 5 / Math.max(r, 1e-3) },
    });
    const a0 = new Float64Array(n * 3);
    const a1 = new Float64Array(n * 3);
    bare.accelerations(s.pos, s.mass, a0, 0);
    withGas.accelerations(s.pos, s.mass, a1, 0);

    // A background of 5x the cluster mass must deepen the well everywhere, not somewhere.
    for (let i = 0; i < n; i++) {
      const mag = (v: Float64Array): number => Math.hypot(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      expect(mag(a1)).toBeGreaterThan(mag(a0));
    }
    expect(withGas.potentialEnergy(s.pos, s.mass, 0)).toBeLessThan(
      bare.potentialEnergy(s.pos, s.mass, 0),
    );
  });
});
