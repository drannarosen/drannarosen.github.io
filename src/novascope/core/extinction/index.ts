/*
 * core/extinction — dust reddening (Layer 0, pure). Rung 5 of the theory->observation ladder.
 *
 * The roadmap's ladder had one rung marked "not built", and this is it. Extinction is what
 * makes a star look redder AND fainter than it is, and — crucially for this codebase — it is
 * the first thing in the whole pipeline that changes the SHAPE of a spectrum rather than
 * scaling it. That has a consequence recorded in `viz/spectral.ts`: a Teff->RGB fit cannot
 * express a reddened star at all, because there is no temperature that means "20000 K behind
 * dust". A spectrum can be reddened and then integrated; a fitted colour cannot.
 *
 * ── THE ORDER OF OPERATIONS IS THE WHOLE THING ──
 *
 * Redden the SPECTRUM, then integrate through the filter. Never apply an extinction at a
 * band's effective wavelength to an already-integrated flux. Both produce a number; only one
 * is right, and the wrong one is invisible in the output because it is smooth, plausible and
 * of the correct order.
 *
 * That is why this module exposes `attenuation(lambda)` — a per-wavelength factor meant to be
 * multiplied into an integrand — rather than a per-band magnitude offset. The band integral in
 * `core/photometry/passbands` takes it as an optional argument, so extinction composes into
 * the existing forward model instead of being bolted onto its output.
 *
 * It also means novascope gets the HONEST treatment for free. fluxax distinguishes a
 * fixed-SED linear law from a Teff-aware one and needs a precomputed trilinear grid for the
 * latter, because it must be differentiable. Nothing here must be differentiable, and the
 * per-star spectrum is already being integrated — so multiplying the integrand by
 * 10^(-0.4 A(lambda)) gives the temperature-dependent answer directly, with no grid.
 *
 * ── A_V IS A FREE PARAMETER OF THE LAB, NOT A MEASUREMENT ──
 *
 * Nothing here derives how much dust lies in front of anything. A_V is set by the reader, and
 * any page using it must say so. Deriving it from a gravoturb gas column is the named next
 * step and is deliberately not done here.
 */
import { ccm89AOverAv, ccm89Covers, CCM89_RANGE_NM } from "./ccm89.ts";
import { g23AOverAv, g23Covers, G23_RANGE_NM, G23_RV_RANGE, R_V_MW } from "./g23.ts";

export { ccm89AOverAv, ccm89Covers, CCM89_RANGE_NM } from "./ccm89.ts";
export { g23AOverAv, g23Covers, G23_RANGE_NM, G23_RV_RANGE, R_V_MW } from "./g23.ts";

export type ExtinctionLawId = "g23" | "ccm89";

export interface ExtinctionLaw {
  id: ExtinctionLawId;
  /** Short label for a control. */
  label: string;
  /** Author-year citation, for the page to print beside the control. */
  citation: string;
  /** Wavelength range [nm] the law's coefficients are published over. */
  rangeNm: { readonly min: number; readonly max: number };
  /** R_V range the law is fitted over, or null where the source does not state one. */
  rvRange: { readonly min: number; readonly max: number } | null;
  /** A(lambda)/A_V, or NaN outside `rangeNm`. */
  aOverAv(lambdaNm: number, rv: number): number;
  /** Whether `aOverAv` will return a real number here. */
  covers(lambdaNm: number): boolean;
}

/**
 * The laws, in the order a control should offer them: the one that covers everything first.
 *
 * TWO, DELIBERATELY. A single law would present a modelled quantity as a settled one. The
 * published disagreement between these two is real and quantified — Gordon+2023 Fig 8 reports
 * an average fractional deviation of 0.03 and a maximum of 0.18 against CCM89 at R_V = 3.1 —
 * so showing both is an honest statement about model uncertainty rather than an option for
 * its own sake.
 */
export const EXTINCTION_LAWS: readonly ExtinctionLaw[] = [
  {
    id: "g23",
    label: "Gordon+ 2023",
    citation: "Gordon et al. (2023), ApJ 950, 86",
    rangeNm: G23_RANGE_NM,
    rvRange: G23_RV_RANGE,
    aOverAv: g23AOverAv,
    covers: g23Covers,
  },
  {
    id: "ccm89",
    label: "Cardelli+ 1989",
    citation: "Cardelli, Clayton & Mathis (1989), ApJ 345, 245",
    rangeNm: CCM89_RANGE_NM,
    /* The paper does not state an R_V validity interval the digest records, and inventing one
       would be a fabricated constraint. Stated as unknown rather than guessed. */
    rvRange: null,
    aOverAv: ccm89AOverAv,
    covers: ccm89Covers,
  },
];

export function extinctionLaw(id: ExtinctionLawId): ExtinctionLaw {
  const law = EXTINCTION_LAWS.find((l) => l.id === id);
  if (!law) throw new Error(`unknown extinction law: ${id}`);
  return law;
}

export interface ExtinctionSpec {
  /** V-band extinction [mag]. 0 disables extinction entirely. */
  aV: number;
  /** Total-to-selective ratio A_V / E(B-V). Milky Way diffuse average is 3.1. */
  rv?: number;
  /** Which curve. Default "g23", the only one covering every band here. */
  law?: ExtinctionLawId;
}

/**
 * The transmitted fraction at one wavelength: 10^(-0.4 A(lambda)).
 *
 * Multiply an integrand by this. 1 means nothing is absorbed.
 *
 * A_V = 0 RETURNS EXACTLY 1, by an early return rather than by arithmetic that happens to
 * come out at 1. That is what lets `attenuationFor` hand back `undefined` and every existing
 * flux stay bit-identical — the property the gate asserts, and the reason adding extinction
 * cannot perturb a single shipped page until someone turns it on.
 */
export function attenuation(lambdaNm: number, spec: ExtinctionSpec): number {
  if (!(spec.aV > 0)) return 1;
  const law = extinctionLaw(spec.law ?? "g23");
  const ratio = law.aOverAv(lambdaNm, spec.rv ?? R_V_MW);
  if (!Number.isFinite(ratio)) return NaN; // outside the law's domain — loud, not silent
  return 10 ** (-0.4 * spec.aV * ratio);
}

/**
 * A reusable per-wavelength attenuation function, or `undefined` when there is no extinction.
 *
 * `undefined` rather than a function returning 1, so a caller can skip the work entirely and
 * so the no-extinction path is provably the original one.
 */
export function attenuationFor(spec: ExtinctionSpec | undefined): ((nm: number) => number) | undefined {
  if (!spec || !(spec.aV > 0)) return undefined;
  const law = extinctionLaw(spec.law ?? "g23");
  const rv = spec.rv ?? R_V_MW;
  const k = -0.4 * spec.aV;
  return (nm: number): number => {
    const ratio = law.aOverAv(nm, rv);
    return Number.isFinite(ratio) ? 10 ** (k * ratio) : NaN;
  };
}

/**
 * Colour excess E(B-V) = A_B - A_V, from A_V and R_V.
 *
 * Definitional: R_V := A_V / E(B-V), so E(B-V) = A_V / R_V. This is NOT the same as
 * integrating the curve through this repo's B and V passband curves and differencing, because
 * R_V is defined on monochromatic effective wavelengths rather than on integrated bands. The
 * two differ by a small, stable amount, and `extinction.test.ts` measures that difference
 * rather than asserting they are equal.
 */
export function colourExcess(aV: number, rv: number = R_V_MW): number {
  return aV / rv;
}
