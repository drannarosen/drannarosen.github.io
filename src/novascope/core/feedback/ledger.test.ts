import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAKAGE,
  WIND_LEAK_DEFAULT,
  computeLedger,
  gasExpulsionVerdict,
  resolveLeakage,
  resolvePrescription,
  type LedgerInput,
} from "./ledger.ts";
import { momentumTrajectory } from "./trajectory.ts";

/** Uniform-density enclosed-gas stand-in, so the tests need no data files. */
const MENC = Array.from({ length: 256 }, (_, i) => (i / 255) ** 3);

const base: LedgerInput = {
  mass: [40], teff: [40000], radius: [10],
  mCloud: 2e4, rCloudPc: 2.5, effGamma: 4.2, effAPc: 0.8, vEscCloud: 8.4,
  sfe: 0.2, tCrossMyr: 1.64, qVirialStarsOnly: 0.03,
  gasMencFrac: MENC, gasMencRMaxPc: 2.5,
};

describe("gasExpulsionVerdict — the two stages are independent", () => {
  const gv = (p: number, q: number) => gasExpulsionVerdict(p, 2e4, 0.2, 8.4, q);

  it("measures stage 1 against the GAS mass, not the cloud", () => {
    /* The stars are the sources, not the payload. */
    expect(gv(1e5, 0.02).gasMomentumNeeded).toBeCloseTo(1.6e4 * 8.4, 6);
  });

  it("puts the survival line exactly at q = 1, the sign of the total energy", () => {
    expect(gv(2e5, 0.999).clusterSurvives).toBe(true);
    expect(gv(2e5, 1.001).clusterSurvives).toBe(false);
  });

  it("labels bound-but-super-virial separately from unbound", () => {
    expect(gv(2e5, 0.03).survivalLabel).toBe("survives");
    expect(gv(2e5, 0.7).survivalLabel).toBe("expands");
    expect(gv(2e5, 0.7).clusterSurvives).toBe(true);
    expect(gv(2e5, 1.5).survivalLabel).toBe("dissolves");
  });

  it("does not let stage 1 influence stage 2", () => {
    /* Survival is read from the export and responds to nothing in the budget.
       The page copy must not imply otherwise. */
    for (const p of [0, 1e3, 1e9]) expect(gv(p, 0.03).survivalLabel).toBe("survives");
  });

  it("carries NO t_remove — that is the trajectory's, and only its", () => {
    /* Two homes for one fact: the ledger's window/ratio estimate assumed linear
       accumulation and disagreed with the interpolated value by up to 31%. */
    expect("tRemoveMyr" in gv(2e5, 0.03)).toBe(false);
    expect("removalRegime" in gv(2e5, 0.03)).toBe(false);
  });
});

describe("resolveLeakage — one resolution, shared", () => {
  it("gives each prescription its own calibrated windLeak", () => {
    expect(resolveLeakage({ prescription: "bjorklund" }).windLeak).toBe(WIND_LEAK_DEFAULT.bjorklund);
    expect(resolveLeakage({ prescription: "vink" }).windLeak).toBe(WIND_LEAK_DEFAULT.vink);
    expect(WIND_LEAK_DEFAULT.bjorklund).not.toBe(WIND_LEAK_DEFAULT.vink);
  });

  it("lets an explicit caller override win over both", () => {
    expect(resolveLeakage({ prescription: "vink", leakage: { windLeak: 0.1 } }).windLeak).toBe(0.1);
  });

  it("defaults the prescription in exactly one place", () => {
    expect(resolvePrescription({})).toBe("bjorklund");
    expect(resolvePrescription({ prescription: "vink" })).toBe("vink");
  });

  it("is what the trajectory uses too, so a Vink run cannot keep Björklund's value", () => {
    const vink: LedgerInput = { ...base, prescription: "vink" };
    expect(resolveLeakage(vink).windLeak).toBe(WIND_LEAK_DEFAULT.vink);
  });
});

describe("porosity coupling", () => {
  const run = (c: "independent" | "simple" | "km09") =>
    computeLedger({ ...base, leakage: { porosityCoupling: c, coveringFraction: 0.5 } });

  it("ships `simple` by default, so C_f and f_vent cannot contradict", () => {
    /* C_f = 0.5 (half the sky is holes) beside f_vent = 0 (nothing escapes them)
       is a state with no physical referent. */
    expect(DEFAULT_LEAKAGE.porosityCoupling).toBe("simple");
  });

  it("orders the three couplings by how much wind momentum survives", () => {
    const [ind, simple, km] = [run("independent"), run("simple"), run("km09")];
    const p = (L: ReturnType<typeof computeLedger>) =>
      L.channels.find((c) => c.name === "winds")!.momentum;
    expect(p(ind)).toBeGreaterThan(p(simple));
    expect(p(simple)).toBeGreaterThan(p(km));
  });

  it("returns eta = 1 under km09 at C_f = 0.5", () => {
    expect(run("km09").channels.find((c) => c.name === "winds")!.eta).toBe(1);
  });

  it("halves the wind momentum under `simple` at C_f = 0.5", () => {
    const a = computeLedger({ ...base, leakage: { porosityCoupling: "independent", coveringFraction: 0.5, windVent: 0 } });
    const b = computeLedger({ ...base, leakage: { porosityCoupling: "simple", coveringFraction: 0.5 } });
    const p = (L: ReturnType<typeof computeLedger>) =>
      L.channels.find((c) => c.name === "winds")!.momentum;
    expect(p(b) / p(a)).toBeCloseTo(0.5, 6);
  });
});

describe("computeLedger — channel bookkeeping", () => {
  const L = computeLedger(base);

  it("gives radiation momentum but no energy", () => {
    /* It deposits momentum, not thermal energy, into the cloud. */
    const rad = L.channels.find((c) => c.name === "radiation")!;
    expect(rad.momentum).toBeGreaterThan(0);
    expect(rad.energy).toBe(0);
  });

  it("totals are the sum of the entries", () => {
    expect(L.totalMomentum).toBeCloseTo(L.channels.reduce((s, c) => s + c.momentum, 0), 9);
    expect(L.totalEnergy).toBeCloseTo(L.channels.reduce((s, c) => s + c.energy, 0), 9);
  });

  it("zeroes a channel that is switched off, without touching the others", () => {
    const off = computeLedger({ ...base, enabled: { winds: false } });
    expect(off.channels.find((c) => c.name === "winds")!.momentum).toBe(0);
    expect(off.channels.find((c) => c.name === "radiation")!.momentum)
      .toBeCloseTo(L.channels.find((c) => c.name === "radiation")!.momentum, 9);
  });

  it("bands the ENERGY ratio over gamma but not the momentum one", () => {
    /* M v_esc carries no gamma dependence, so a band there would be decorative. */
    const [lo, hi] = L.energyRatioRange;
    expect(lo).toBeLessThanOrEqual(hi);
    expect(L.energyRatio).toBeGreaterThanOrEqual(lo * 0.999);
  });
});

describe("trajectory agrees with the static ledger", () => {
  it("ends exactly at the ledger total", () => {
    const t = momentumTrajectory(base, 40);
    expect(t.totalMomentum.at(-1)).toBeCloseTo(computeLedger(base).totalMomentum, 6);
  });

  it("accumulates monotonically and caps the cleared fraction at 1", () => {
    const t = momentumTrajectory(base, 60);
    for (let i = 1; i < t.totalMomentum.length; i++) {
      expect(t.totalMomentum[i]!).toBeGreaterThanOrEqual(t.totalMomentum[i - 1]! - 1e-9);
    }
    expect(Math.max(...t.clearedFraction)).toBeLessThanOrEqual(1);
  });

  it("reads the removal regime off two TIMES it actually has", () => {
    const t = momentumTrajectory(base, 60);
    expect(t.removalRegime).toBe(t.tRemoveMyr < t.tCrossMyr ? "impulsive" : "adiabatic");
  });

  it("calls an unreachable threshold adiabatic, not impulsive", () => {
    /* Infinity < t_cross is false, which is the correct default: an unbounded
       removal time is the slow limit. */
    const starved = momentumTrajectory({ ...base, mCloud: 1e9 }, 20);
    expect(Number.isFinite(starved.tRemoveMyr)).toBe(false);
    expect(starved.removalRegime).toBe("adiabatic");
  });
});
