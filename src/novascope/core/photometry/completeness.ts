/*
 * completeness.ts — the bridge between an EXPOSURE and a MASS (Layer 0, pure).
 *
 * An observation and a theory both describe the same cluster, and they meet here. A
 * telescope reaching magnitude m sees stars down to some mass; a model complete to
 * some mass demands a telescope reaching some magnitude. Those are not two facts, they
 * are ONE relation read in two directions, and this module is the only place either
 * direction is computed.
 *
 * Writing them as two independent calculations is the obvious approach and it is how
 * they drift: a rounded constant here, a different metallicity there, and the page
 * ends up asserting that 24th magnitude reaches 0.33 Msun while also asserting that
 * 0.33 Msun needs 23.6. So `magnitudeForMass` and `massForMagnitudeLimit` are exact
 * inverses by construction — the second bisects the first — and `check:completeness`
 * gates the round trip rather than trusting it.
 *
 * That gate is not ceremony. `softeningForLimit` in core/imaging is the same shape of
 * function, and its first version was INVERTED: it read a monotonically decreasing
 * relation as increasing and answered a 10-magnitude request with 30.6 magnitudes. It
 * looked plausible and the only thing that caught it was round-tripping.
 *
 * WHAT IS ASSUMED. Stars sit on the zero-age main sequence (Tout et al. 1996 via
 * core/stellar), radiate as blackbodies through the measured filter curves, and are
 * unreddened. The first two are the model this whole package is built on; the third is
 * the honest limit — extinction moves every number here in the same direction (fainter,
 * so a higher limiting mass) and is not yet modelled. A real completeness limit in a
 * dusty region is WORSE than these values, never better.
 */

import { zamsRadius, zamsTeff } from "../stellar/index.ts";
import { abMagnitude, type Passband } from "./passbands.ts";

/**
 * Mass bounds for the inversion [Msun].
 *
 * Not a claim about which stars exist — that is the IMF's business in core/cluster.
 * These are the bracket the bisection searches, chosen to span the hydrogen-burning
 * limit at the bottom and comfortably past the most massive stars observed at the top,
 * so a limit outside the range is reported as a saturated bound rather than a wrong
 * mass inside it.
 */
export const MASS_SEARCH_MIN = 0.08;
export const MASS_SEARCH_MAX = 120;

/**
 * Apparent AB magnitude of a ZAMS star of the given mass, through the given band.
 *
 * STRICTLY DECREASING IN MASS in every band this package ships, which is what makes
 * the inverse below well posed. That is a property of the ZAMS rather than an
 * assumption — luminosity and radius both rise monotonically with mass, so the band
 * flux does too — but it is verified over 0.08-120 Msun in all 30 bands by
 * `check:completeness`, because a bisection on a non-monotonic function returns a
 * confident wrong answer.
 */
export function magnitudeForMass(
  massMsun: number,
  band: Passband,
  distancePc: number,
): number {
  if (!(massMsun > 0) || !(distancePc > 0)) return Infinity;
  return abMagnitude(zamsTeff(massMsun), zamsRadius(massMsun), distancePc, band);
}

/**
 * The least massive ZAMS star still reaching `magLimit` — the completeness limit of an
 * exposure, in solar masses.
 *
 * Bisects `magnitudeForMass` in LOG mass, because the useful range spans three decades
 * and a linear bisection would waste its resolution at the top where nothing lives.
 * 60 iterations take the bracket to a part in 10^18, far past the precision the ZAMS
 * fit itself justifies; the cost is a few dozen band integrals, which is nothing beside
 * preparing a starfield.
 *
 * SATURATES RATHER THAN LYING at both ends. A limit too shallow to reach even the most
 * massive star returns `MASS_SEARCH_MAX` (nothing is complete), and one deep enough to
 * reach the hydrogen-burning limit returns `MASS_SEARCH_MIN` (everything is). Both are
 * clamped bounds and callers that need to say "deeper than this model goes" should
 * compare against the constants, which is why they are exported.
 */
export function massForMagnitudeLimit(
  magLimit: number,
  band: Passband,
  distancePc: number,
): number {
  if (!Number.isFinite(magLimit) || !(distancePc > 0)) return MASS_SEARCH_MAX;
  // Brighter (smaller) magnitudes lie at HIGHER mass, so the relation decreases.
  if (magnitudeForMass(MASS_SEARCH_MAX, band, distancePc) > magLimit) return MASS_SEARCH_MAX;
  if (magnitudeForMass(MASS_SEARCH_MIN, band, distancePc) <= magLimit) return MASS_SEARCH_MIN;
  let lo = Math.log(MASS_SEARCH_MIN);
  let hi = Math.log(MASS_SEARCH_MAX);
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    // Fainter than the limit means this mass is NOT detected, so search higher.
    if (magnitudeForMass(Math.exp(mid), band, distancePc) > magLimit) lo = mid;
    else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}

/**
 * The exposure depth a survey needs to be complete to `massMsun` — the same relation
 * as `magnitudeForMass`, named for the question an observer asks of a model.
 *
 * A separate name rather than a second implementation. It exists because "how deep must
 * I go" and "how bright is this star" read as different questions in a caption even
 * though they are one calculation, and a reader who finds only `magnitudeForMass` tends
 * to write the inverse again by hand.
 */
export function depthForMassLimit(
  massMsun: number,
  band: Passband,
  distancePc: number,
): number {
  return magnitudeForMass(massMsun, band, distancePc);
}
