/*
 * censusParams.ts — `/explore/census` as an address (Layer 0, pure).
 *
 * The schema half of `urlState` for the census engine, and the mapping between a FLAT query
 * string and the NESTED `ClusterIdentity` the engine actually runs on. It lives in core, beside
 * the codec rather than inside the component, for the reason `labParams.ts` gives for the star
 * lab's: a mapping in a `<script>` block cannot be tested in node, and this one has arithmetic
 * in it (r_h -> a, and the environment mode's derivations) rather than being a rename.
 *
 * ── THE URL CARRIES INPUTS, NEVER DERIVED VALUES ──
 *
 * Two fields on this page are OUTPUTS of others, and writing them would make a link ambiguous
 * about which one wins on the way back in:
 *
 *   - `a` (the profile's scale radius) is derived from r_h and gamma through `effRhOverA`, so
 *     the URL carries `rh` — the number the reader set and the number the control shows.
 *     Carrying `a` instead would make a link silently mean a different r_h at a different gamma.
 *
 *   - In ENVIRONMENT MODE the IMF slope and the star count are both derived from [Fe/H] and
 *     M_ecl (Marks & Jerabkova). So `env` suppresses `alpha` and `n` entirely: a link either
 *     states the environment, or it states alpha and N, and never both. A URL carrying all four
 *     would have to pick a winner, and whichever it picked would be wrong half the time.
 *
 * ── WHY THERE IS NO `preset=` KEY ──
 *
 * `urlState`'s own docstring makes the point: "a preset is a named URL". A `preset=starburst`
 * key would be a second name for a state the other keys already describe completely, and the
 * two would disagree the moment anyone nudged a slider with a preset selected. So a preset
 * button writes its identity into the URL like any other change, and the highlight is DERIVED
 * by comparing the live identity back against the preset table (`presetKeyFor`) — which also
 * means a hand-built link that happens to match a preset lights that preset up, and one that
 * has drifted a step away correctly does not.
 *
 * ── `view` IS TRI-STATE, AND THAT IS NOT AN ACCIDENT ──
 *
 * 2-D/3-D is the one control on this page that genuinely persists per reader: `createClusterStore`
 * restores `view` from localStorage even though it does not restore the identity (measured — see
 * the engine's note). If `view` were a two-valued field, "absent from the URL" would decode to
 * "2D" and a bare visit would overwrite the reader's own restored 3-D. `auto` is the third state
 * that means "the URL is not asserting anything here", which is the same fix, for the same
 * reason, that the star lab's `motion` field uses.
 */
import {
  boolField,
  enumField,
  numberField,
  type StateOf,
} from "./urlState.ts";
import {
  defaultIdentity,
  presets,
  type ClusterIdentity,
} from "../cluster/params.ts";
import { effRhOverA } from "../cluster/profiles.ts";
import { alpha3FromEnvironment } from "../imf/index.ts";

/**
 * Census's own starting identity — 1200 stars over 0.1-100 M☉, which is NOT `defaultIdentity()`.
 *
 * Exported so the engine and this schema's defaults come from one object. They were two literals
 * in two files, which is the shape the site-integrity rule is about: nothing would have failed if
 * they drifted, and the symptom would have been a "default" link that did not reproduce a bare
 * visit.
 */
export const CENSUS_IDENTITY: ClusterIdentity = defaultIdentity({
  sampling: { mode: "count", target: 1200 },
  imf: { mMin: 0.1, mMax: 100, alphaHigh: 2.3 },
});

/** r_h of the census default, in pc — derived from its own profile, never retyped. */
const CENSUS_RH = CENSUS_IDENTITY.profile.scaleRadius * effRhOverA(CENSUS_IDENTITY.profile.gamma ?? 5);

/*
 * Ranges MIRROR the controls' own min/max, so a hand-edited or stale link is clamped into
 * something runnable rather than rejected. Where a slider's travel is logarithmic the URL
 * carries the QUANTITY, not the slider position: `n=1200` is a cluster, `n=3.079` is a widget
 * coordinate, and only one of those is still meaningful if the control is ever rescaled.
 */
export const CENSUS_SCHEMA = {
  seed: numberField(0, 4294967295, CENSUS_IDENTITY.seed, 0),
  /**
   * How the draw is limited. NOT inferable from the other keys, and leaving it out was a bug:
   * two of the five presets (`starburst`, and any mass-limited link) are `mode: "mass"`, and a
   * schema that could only say "count" silently rewrote them. Measured before the fix — the
   * starburst URL reopened as 20,000 STARS totalling 25,076 M☉ instead of a 30,000 M☉ draw.
   */
  sm: enumField(["count", "mass"] as const, "count"),
  /** Star count, when `sm=count`. The slider is log10 1.301-4.301; this is 10^that, rounded. */
  n: numberField(20, 20000, CENSUS_IDENTITY.sampling.target, 0),
  /** Target stellar mass [M☉], when `sm=mass`. Separate from `n` because they are different
   *  quantities with different ranges — one key doing both would clamp 3e4 stars-or-suns alike. */
  mass: numberField(100, 1e6, 10000, 0),
  /**
   * The IMF's upper mass limit [M☉]. A preset varies it (`starburst` goes to 120) and it changes
   * what the cluster CONTAINS, so a link that dropped it drew a different population — the same
   * omission as `sm`, found the same way.
   */
  mmax: numberField(10, 150, CENSUS_IDENTITY.imf.mMax, 0),
  alpha: numberField(1.5, 3, CENSUS_IDENTITY.imf.alphaHigh, 2),
  seg: numberField(0, 1, CENSUS_IDENTITY.segregation, 2),
  /** Half-mass radius [pc] — the control's own quantity; `a` is derived from it and gamma. */
  rh: numberField(0.3, 5, CENSUS_RH, 2),
  gamma: numberField(2.5, 6, CENSUS_IDENTITY.profile.gamma ?? 5, 1),
  /** Environment mode: alpha and n become derived, and are omitted from the link. */
  env: boolField(false),
  feh: numberField(-2, 0.5, 0, 1),
  /** log10(M_ecl / M☉) — the control's unit, and what keeps the key readable. */
  mecl: numberField(3, 4.3, 4, 2),
  view: enumField(["auto", "2D", "3D"] as const, "auto"),
  imf: enumField(["dNdM", "perDex"] as const, "dNdM"),
} as const;

export type CensusState = StateOf<typeof CENSUS_SCHEMA>;

/** The env-mode alpha, clamped exactly as the engine's own `applyEnv` clamps it. */
export function envAlpha(feh: number, meclLog10: number): number {
  return Math.min(2.8, Math.max(1.1, alpha3FromEnvironment(feh, 10 ** meclLog10)));
}

/**
 * A decoded URL state -> the identity to run.
 *
 * The env branch is the whole reason this is a function rather than a spread: alpha and the
 * sampling mode BOTH change meaning, and a caller reconstructing that inline is a caller who
 * will get it right once and then drift.
 */
export function identityFromState(s: CensusState): ClusterIdentity {
  const gamma = s.gamma;
  const base: ClusterIdentity = {
    ...CENSUS_IDENTITY,
    seed: s.seed,
    segregation: s.seg,
    /* a from r_h at THIS gamma, so the quoted r_h stays true as the shape changes — the same
       derivation `setGeometry` does in the engine, called rather than repeated. */
    profile: { kind: "eff", scaleRadius: s.rh / effRhOverA(gamma), gamma },
    imf: { ...CENSUS_IDENTITY.imf, mMax: s.mmax, alphaHigh: s.alpha },
    sampling:
      s.sm === "mass" ? { mode: "mass", target: s.mass } : { mode: "count", target: s.n },
  };
  if (!s.env) return base;
  return {
    ...base,
    imf: { ...base.imf, alphaHigh: envAlpha(s.feh, s.mecl) },
    /* M_ecl IS the cluster's stellar mass, so the draw is mass-limited to it and N is an
       outcome rather than an input. */
    sampling: { mode: "mass", target: 10 ** s.mecl },
  };
}

/**
 * The identity (plus the two view choices) -> the state to encode.
 *
 * In env mode `alpha` and `n` are forced back to their schema defaults so `encode` omits them.
 * Leaving the live values in would write a DERIVED number into the link, which is the thing the
 * header rules out — and it would also freeze today's Marks & Jerabkova coefficients into every
 * old link, so improving them would stop reaching anyone who had bookmarked a cluster.
 */
export function stateFromIdentity(
  id: ClusterIdentity,
  extra: { env: boolean; feh: number; mecl: number; view: "auto" | "2D" | "3D"; imf: "dNdM" | "perDex" },
): CensusState {
  const gamma = id.profile.gamma ?? 5;
  const byMass = !extra.env && id.sampling.mode === "mass";
  return {
    seed: id.seed,
    /* `sm` is suppressed in env mode along with the target: the mode is implied there ("mass",
       always), and stating it would be a second copy of a fact `env` already carries. */
    sm: byMass ? "mass" : CENSUS_SCHEMA.sm.default,
    n: extra.env || byMass ? CENSUS_SCHEMA.n.default : id.sampling.target,
    mass: byMass ? id.sampling.target : CENSUS_SCHEMA.mass.default,
    mmax: id.imf.mMax,
    alpha: extra.env ? CENSUS_SCHEMA.alpha.default : id.imf.alphaHigh,
    seg: id.segregation,
    rh: id.profile.scaleRadius * effRhOverA(gamma),
    gamma,
    env: extra.env,
    feh: extra.feh,
    mecl: extra.mecl,
    view: extra.view,
    imf: extra.imf,
  };
}

/*
 * Which preset this identity IS, or null.
 *
 * Compared on the fields a preset actually varies, and at the schema's own written precision —
 * a preset's r_h round-trips through `a = rh / effRhOverA(gamma)` and back, so an exact
 * comparison would fail on the last bit and no preset would ever light up.
 */
export function presetKeyFor(id: ClusterIdentity): string | null {
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  for (const [key, p] of Object.entries(presets)) {
    const gi = id.profile.gamma ?? 5;
    const gp = p.profile.gamma ?? 5;
    if (
      id.seed === p.seed &&
      id.sampling.mode === p.sampling.mode &&
      near(id.sampling.target, p.sampling.target, 0.5) &&
      near(id.imf.alphaHigh, p.imf.alphaHigh, 5e-3) &&
      near(id.imf.mMax, p.imf.mMax, 1e-9) &&
      near(id.segregation, p.segregation, 5e-3) &&
      near(gi, gp, 5e-2) &&
      near(id.profile.scaleRadius * effRhOverA(gi), p.profile.scaleRadius * effRhOverA(gp), 5e-3)
    )
      return key;
  }
  return null;
}
