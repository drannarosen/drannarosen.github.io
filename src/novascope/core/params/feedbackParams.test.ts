import { describe, expect, it } from "vitest";
import { decode, encode } from "./urlState.ts";
import {
  FEEDBACK_ENVIRONMENTS,
  FEEDBACK_SCHEMA,
  enabledFromState,
  envFromPath,
  leakageFromState,
  pathFromEnv,
  prescriptionFromState,
} from "./feedbackParams.ts";
import { DEFAULT_LEAKAGE, WIND_LEAK_DEFAULT } from "../feedback/ledger.ts";
import { COVERING_FRACTION_DEFAULT } from "../feedback/radiation.ts";

const rt = (q: string) => encode(FEEDBACK_SCHEMA, decode(FEEDBACK_SCHEMA, q));

describe("round-trip", () => {
  it("writes nothing for a freshly-loaded page", () => {
    expect(encode(FEEDBACK_SCHEMA, decode(FEEDBACK_SCHEMA, ""))).toBe("");
  });

  it("survives every environment, which is the link a talk would use", () => {
    for (const env of FEEDBACK_ENVIRONMENTS) {
      const q = env === "" ? "" : `env=${env}`;
      expect(decode(FEEDBACK_SCHEMA, rt(q)).env).toBe(env);
    }
  });

  it("survives a fully-specified state", () => {
    const q = "env=compact&presc=vink&cf=0.8&hii=0.25&coup=km09&winds=false&photo=false";
    const a = decode(FEEDBACK_SCHEMA, q);
    const b = decode(FEEDBACK_SCHEMA, encode(FEEDBACK_SCHEMA, a));
    expect(b).toEqual(a);
  });

  it("carries only what was changed", () => {
    const s = decode(FEEDBACK_SCHEMA, "");
    const q = encode(FEEDBACK_SCHEMA, { ...s, cf: 0.8 });
    expect(q).toBe("cf=0.8");
  });
});

describe("degrading, not throwing — these links outlive their builds", () => {
  it("clamps an out-of-range number rather than discarding it", () => {
    /* Clamping keeps the direction of the intent; falling back to the default
       throws it away. */
    expect(decode(FEEDBACK_SCHEMA, "cf=5").cf).toBe(1);
    expect(decode(FEEDBACK_SCHEMA, "cf=-3").cf).toBe(0);
  });

  it("falls back on an unparseable value", () => {
    expect(decode(FEEDBACK_SCHEMA, "cf=banana").cf).toBe(COVERING_FRACTION_DEFAULT);
    expect(decode(FEEDBACK_SCHEMA, "presc=nonesuch").presc).toBe("bjorklund");
    expect(decode(FEEDBACK_SCHEMA, "env=atlantis").env).toBe("");
  });

  it("ignores unknown keys, so a link survives a control being removed", () => {
    expect(decode(FEEDBACK_SCHEMA, "cf=0.7&removedControl=9").cf).toBe(0.7);
  });
});

describe("the URL carries inputs, never derived values", () => {
  it("has no windLeak key — it is an output of the prescription", () => {
    /* Carrying it would freeze today's Lancaster calibration into every old
       link, so a bookmarked lecture would keep running an obsolete leakage
       after the measured alpha_p moved. */
    expect(Object.keys(FEEDBACK_SCHEMA)).not.toContain("windLeak");
    expect(WIND_LEAK_DEFAULT.bjorklund).not.toBe(WIND_LEAK_DEFAULT.vink);
  });

  it("has no fTrap key — it is computed per environment from C_f", () => {
    expect(Object.keys(FEEDBACK_SCHEMA)).not.toContain("fTrap");
    expect(Object.keys(FEEDBACK_SCHEMA)).toContain("cf");
  });
});

describe("mapping onto the shapes the ledger takes", () => {
  const s = decode(FEEDBACK_SCHEMA, "cf=0.8&hii=0.25&coup=km09&presc=vink&photo=false");

  it("splits one flat state across leakage, channels and prescription", () => {
    expect(leakageFromState(s)).toEqual({
      coveringFraction: 0.8, hiiLeak: 0.25, porosityCoupling: "km09",
    });
    expect(enabledFromState(s)).toEqual({
      winds: true, photoionization: false, radiation: true,
    });
    expect(prescriptionFromState(s)).toBe("vink");
  });

  it("leaves windLeak unset, so the prescription's calibration still applies", () => {
    expect("windLeak" in leakageFromState(s)).toBe(false);
  });

  it("agrees with the shipped defaults when nothing is specified", () => {
    const d = decode(FEEDBACK_SCHEMA, "");
    expect(leakageFromState(d).coveringFraction).toBe(COVERING_FRACTION_DEFAULT);
    expect(leakageFromState(d).hiiLeak).toBe(DEFAULT_LEAKAGE.hiiLeak);
    expect(leakageFromState(d).porosityCoupling).toBe(DEFAULT_LEAKAGE.porosityCoupling);
  });
});

describe("environment names, not indices", () => {
  it("round-trips every name through its manifest path", () => {
    /* An index would repoint at a different cloud the moment a realization is
       added or reordered, and nothing here could notice. */
    for (const env of FEEDBACK_ENVIRONMENTS) {
      expect(envFromPath(pathFromEnv(env))).toBe(env);
    }
  });

  it("maps the empty name to the root, as loadFeedbackRealization does", () => {
    expect(pathFromEnv("")).toBe("/data/gravoturb");
    expect(pathFromEnv("compact")).toBe("/data/gravoturb/compact");
  });
});
