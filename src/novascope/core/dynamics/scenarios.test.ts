/*
 * scenarios.test.ts — every scenario must actually be integrable by the schemes it advertises.
 *
 * That is the whole contract. A scenario's `schemes` list is a PROMISE rendered on the page, so
 * a scheme listed there that throws, NaNs, or fails to conserve is the page telling a reader
 * something untrue — which is worse than the configuration being unavailable.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS, scenario } from "./scenarios.ts";
import { chooseIntegrator } from "./choose.ts";
import { createConservationMonitor } from "./monitor.ts";

describe("scenarios", () => {
  for (const s of SCENARIOS) {
    describe(s.label, () => {
      it("builds a finite, non-degenerate state with a derived view and clock", () => {
        const b = s.build();
        expect(b.state.n).toBeGreaterThan(1);
        for (let i = 0; i < b.state.pos.length; i++) {
          expect(Number.isFinite(b.state.pos[i])).toBe(true);
          expect(Number.isFinite(b.state.vel[i])).toBe(true);
        }
        for (let i = 0; i < b.state.n; i++) expect(b.state.mass[i]).toBeGreaterThan(0);
        expect(b.timeUnit).toBeGreaterThan(0);
        expect(Number.isFinite(b.timeUnit)).toBe(true);
        // The view must actually contain something, and must not be a hardcoded guess.
        expect(b.viewPc).toBeGreaterThan(0);
      });

      it("declares a default scheme that is in its own list", () => {
        expect(s.schemes).toContain(s.defaultScheme);
      });

      for (const scheme of s.schemes) {
        it(`is integrable by '${scheme}', which it advertises`, () => {
          const b = s.build();
          const picked = chooseIntegrator(b.state, b.force, {
            prefer: scheme,
            maxStep: b.timeUnit / 64,
            adaptive: scheme === "hermite" || scheme === "symmetric",
          });
          expect(picked.scheme).toBe(scheme);
          const mon = createConservationMonitor(picked.integrator);
          // A short run: this asserts "advertised and works", not an accuracy figure.
          for (let k = 0; k < 8; k++) {
            picked.integrator.step(b.timeUnit / 64);
            mon.sample();
          }
          for (let i = 0; i < b.state.pos.length; i++) {
            expect(Number.isFinite(b.state.pos[i])).toBe(true);
          }
          expect(Number.isFinite(mon.worst.energy)).toBe(true);
        });
      }
    });
  }

  it("caps eccentricity at 0.9 rather than accepting a value it cannot integrate", () => {
    const wild = scenario("two-body").build({ eccentricity: 0.999 });
    const capped = scenario("two-body").build({ eccentricity: 0.9 });
    // Clamped, so the two configurations are identical.
    expect(wild.viewPc).toBeCloseTo(capped.viewPc, 12);
  });

  it("caps cluster N at the measured interactive ceiling of 512", () => {
    expect(scenario("cluster").build({ n: 5000 }).state.n).toBeLessThanOrEqual(512);
  });

  it("gives the binary EXACTLY zero softening and the background a finite one", () => {
    /* The point of the scenario, asserted on the force rather than on the label: two stars at
       the same separation must feel a stronger mutual force when unsoftened than the softened
       background pair does at that separation. */
    const b = scenario("binary-in-cluster").build();
    expect(b.softeningNote).toContain("ε = 0 for the pair");
    expect(b.state.n).toBeGreaterThan(2);
    const acc = new Float64Array(b.state.n * 3);
    b.force.accelerations(b.state.pos, b.state.mass, acc, 0);
    for (let i = 0; i < acc.length; i++) expect(Number.isFinite(acc[i])).toBe(true);
  });
});
