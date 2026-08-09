/*
 * feedbackParams.ts — `/explore/feedback-budget` as an address (Layer 0, pure).
 *
 * The schema half of `urlState` for the feedback engine, and the mapping between a FLAT query
 * string and the knob objects the ledger actually takes. In core beside the codec rather than
 * inside the component, for the reason `censusParams.ts` gives: a mapping in a `<script>` block
 * cannot be tested in node, and this one is not a rename — it splits one flat state across three
 * different shapes (`LeakageKnobs`, the channel record, and the prescription) and has to know
 * which of them each key belongs to.
 *
 * ── THE URL CARRIES INPUTS, NEVER DERIVED VALUES ──
 *
 * `windLeak` is deliberately ABSENT. It is calibrated per prescription against Lancaster+2025's
 * measured alpha_p (see WIND_LEAK_DEFAULT), so it is an output of `presc`, not an independent
 * setting. Carrying it would make a link ambiguous the moment either the calibration improved or
 * the recipe changed — and worse, it would freeze today's calibration into every old link, so a
 * lecture bookmarked now would keep running an obsolete leakage after the paper's value moved.
 * A reader who wants a different leakage changes the recipe; the recipe brings its own.
 *
 * `fTrap` is absent for the same reason: it is computed per environment from C_f and the shell's
 * own column and temperature, so `cf` is the input and f_trap is what falls out.
 *
 * ── WHY THE CHANNEL SWITCHES ARE THREE BOOLEANS AND NOT ONE LIST ──
 *
 * `?ch=winds,radiation` would be shorter, but it makes "all on" and "none on" look alike under
 * the omit-at-default rule, and it cannot express "H II is off because the reader turned it off"
 * distinctly from "H II is absent from the list". Three flags each default true, so a link
 * carries exactly the ones that were switched OFF — which is the interesting half.
 *
 * ── `env` IS A NAME, NOT AN INDEX ──
 *
 * The realization is carried as its manifest `name` (`compact`, `orion-shallow`, …) rather than
 * as a position in the manifest array. An index would silently point at a different cloud the
 * moment a realization is added or reordered, and this file has no way to notice; a name either
 * resolves or does not. The empty string is the root/fiducial realization, matching what
 * `loadFeedbackRealization` already treats as "no subdirectory".
 */
import { boolField, enumField, numberField, type StateOf } from "./urlState.ts";
import { COVERING_FRACTION_DEFAULT } from "../feedback/radiation.ts";
import { DEFAULT_LEAKAGE } from "../feedback/ledger.ts";
import type { LeakageKnobs } from "../feedback/ledger.ts";
import type { WindPrescription } from "../feedback/winds.ts";
import type { PorosityCoupling } from "../feedback/bubble.ts";

/** The realizations the shipped manifest defines. `""` is the root (Orion-like fiducial). */
export const FEEDBACK_ENVIRONMENTS = [
  "",
  "diffuse",
  "compact",
  "orion-solenoidal",
  "orion-compressive",
  "orion-shallow",
] as const;

export const FEEDBACK_SCHEMA = {
  /** Which cloud. A NAME, so adding a realization cannot repoint an existing link. */
  env: enumField(FEEDBACK_ENVIRONMENTS, ""),
  /** Mass-loss recipe. Brings its own calibrated windLeak, which is why that is not a key. */
  presc: enumField(["bjorklund", "vink"] as const, "bjorklund"),
  /**
   * Shell covering fraction C_f. The one control that drives two channels — the direct
   * radiation term and, through the coupling, the wind venting — so it is a single key for a
   * single physical structure.
   */
  cf: numberField(0, 1, COVERING_FRACTION_DEFAULT, 2),
  /** H II confinement loss. The knob with no citation behind it, hence worth sharing exactly. */
  hii: numberField(0, 1, DEFAULT_LEAKAGE.hiiLeak, 2),
  /** How C_f reaches the wind. See PorosityCoupling; the three disagree by factors of a few. */
  coup: enumField(["simple", "km09", "independent"] as const, "simple"),
  /* Channel switches. Each defaults ON, so a link carries only what was turned off. */
  winds: boolField(true),
  photo: boolField(true),
  rad: boolField(true),
} as const;

export type FeedbackState = StateOf<typeof FEEDBACK_SCHEMA>;

/** The leakage knobs a `FeedbackState` implies. windLeak is left to the prescription. */
export function leakageFromState(s: FeedbackState): Partial<LeakageKnobs> {
  return {
    coveringFraction: s.cf,
    hiiLeak: s.hii,
    porosityCoupling: s.coup as PorosityCoupling,
  };
}

/** The channel record a `FeedbackState` implies. */
export function enabledFromState(s: FeedbackState): {
  winds: boolean;
  photoionization: boolean;
  radiation: boolean;
} {
  return { winds: s.winds, photoionization: s.photo, radiation: s.rad };
}

/** The prescription a `FeedbackState` implies. */
export function prescriptionFromState(s: FeedbackState): WindPrescription {
  return s.presc as WindPrescription;
}

/**
 * The manifest path for a state's environment.
 *
 * One place that knows `""` means the root, so the component and any gate agree. Mirrors what
 * `loadFeedbackRealization` does with an absent name.
 */
export function pathFromEnv(env: string): string {
  return env === "" ? "/data/gravoturb" : `/data/gravoturb/${env}`;
}

/** The environment name for a manifest path — the inverse, so a round-trip is testable. */
export function envFromPath(path: string): string {
  return path === "/data/gravoturb" ? "" : (path.split("/").pop() ?? "");
}
