/*
 * check-completeness.mjs — gate for the exposure <-> mass relation.
 *
 * Two things are asserted, and the second is the reason this file exists.
 *
 *   1. MONOTONICITY. `massForMagnitudeLimit` bisects `magnitudeForMass`, which is only
 *      valid if that function is strictly decreasing in mass. It is — the ZAMS raises
 *      both luminosity and radius with mass — but a bisection on a non-monotonic
 *      function returns a confident wrong answer rather than failing, so the property
 *      is verified over the full mass range in EVERY band rather than assumed for the
 *      handful anyone tests by hand.
 *
 *   2. THE ROUND TRIP. mass -> depth -> mass must return the mass it started from.
 *      `softeningForLimit` in core/imaging is the same shape of function and its first
 *      version was inverted: it read a decreasing relation as increasing and answered a
 *      10-magnitude request with 30.6. Nothing about the code looked wrong. A round-trip
 *      gate is what caught it, and it is what will catch the same mistake here.
 */
import { PASSBANDS } from "../src/novascope/core/photometry/passbands.ts";
import {
  magnitudeForMass,
  massForMagnitudeLimit,
  depthForMassLimit,
  MASS_SEARCH_MIN,
  MASS_SEARCH_MAX,
} from "../src/novascope/core/photometry/completeness.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("completeness (exposure <-> mass):");

const ALL = Object.values(PASSBANDS);
const D = 400;

/* ── 1. MONOTONICITY, in every band, over the whole search range ── */
{
  let worstBand = null;
  let worstStep = 0;
  const N = 1500;
  for (const b of ALL) {
    let prev = Infinity;
    let strict = true;
    for (let i = 0; i < N; i++) {
      const m = MASS_SEARCH_MIN * (MASS_SEARCH_MAX / MASS_SEARCH_MIN) ** (i / (N - 1));
      const mag = magnitudeForMass(m, b, D);
      if (!(mag < prev)) {
        strict = false;
        if (mag - prev > worstStep) {
          worstStep = mag - prev;
          worstBand = b.id;
        }
      }
      prev = mag;
    }
    ok(strict, `${b.id}: magnitude is strictly decreasing in mass over ${MASS_SEARCH_MIN}-${MASS_SEARCH_MAX} Msun`);
  }
  ok(worstBand === null, worstBand === null ? "…so bisection is valid in all 30 bands" : `bisection INVALID in ${worstBand}`);
}

/* ── 2. THE ROUND TRIP ── */
{
  let worst = 0;
  let worstWhere = "";
  for (const b of ALL) {
    for (const m of [0.1, 0.2, 0.5, 1, 2, 5, 20, 60]) {
      const back = massForMagnitudeLimit(depthForMassLimit(m, b, D), b, D);
      const err = Math.abs(back - m) / m;
      if (err > worst) {
        worst = err;
        worstWhere = `${b.id} at ${m} Msun (${back.toFixed(6)})`;
      }
    }
  }
  ok(worst < 1e-9, `mass -> depth -> mass round-trips in all bands (worst ${worst.toExponential(1)} at ${worstWhere})`);

  // …and the other way around, which is a different traversal of the same bracket.
  let worstMag = 0;
  for (const b of ALL) {
    for (const mag of [14, 18, 21, 24]) {
      const m = massForMagnitudeLimit(mag, b, D);
      if (m <= MASS_SEARCH_MIN || m >= MASS_SEARCH_MAX) continue; // saturated, not invertible
      worstMag = Math.max(worstMag, Math.abs(magnitudeForMass(m, b, D) - mag));
    }
  }
  ok(worstMag < 1e-6, `depth -> mass -> depth round-trips (worst ${worstMag.toExponential(1)} mag)`);
}

/* ── Direction, which is exactly what the softeningForLimit bug got wrong ── */
{
  const V = PASSBANDS.V;
  ok(magnitudeForMass(10, V, D) < magnitudeForMass(1, V, D), "a 10 Msun star is BRIGHTER (smaller mag) than a 1 Msun one");
  ok(
    massForMagnitudeLimit(24, V, D) < massForMagnitudeLimit(18, V, D),
    "a DEEPER exposure reaches a LOWER mass — the direction the analogous imaging bug inverted",
  );
  ok(
    magnitudeForMass(1, V, 800) - magnitudeForMass(1, V, 400) - 5 * Math.log10(2) < 1e-9,
    "doubling the distance costs exactly 5 log10(2) magnitudes",
  );
  ok(
    massForMagnitudeLimit(24, V, 800) > massForMagnitudeLimit(24, V, 400),
    "…so the same exposure is complete to a HIGHER mass further away",
  );
}

/* ── Saturation, rather than a wrong mass inside the range ── */
{
  const V = PASSBANDS.V;
  ok(massForMagnitudeLimit(-5, V, D) === MASS_SEARCH_MAX, "an exposure too shallow for any star saturates at the top bound");
  ok(massForMagnitudeLimit(99, V, D) === MASS_SEARCH_MIN, "one deep enough for all of them saturates at the bottom");
  ok(massForMagnitudeLimit(Number.NaN, V, D) === MASS_SEARCH_MAX, "a NaN limit is treated as reaching nothing, not as a mass");
  ok(magnitudeForMass(0, V, D) === Infinity, "a zero-mass star is infinitely faint, not NaN");
  ok(magnitudeForMass(1, V, 0) === Infinity, "a zero distance is rejected rather than dividing by zero");
}

/* ── PHYSICS: the whole reason the band control needed this ──
 *
 * The same star is dramatically fainter in the ultraviolet than the infrared, so the
 * same exposure depth is complete to very different masses depending on the filter.
 * That difference is what the lab's band control was failing to show while the display
 * renormalised itself per band, and these numbers are why the fix is worth making. */
{
  /* Compared at magnitude 18, where NO band saturates against either search bound.
   * At 24 the infrared bands bottom out at MASS_SEARCH_MIN, so a ratio taken there is
   * partly a comparison of clamps rather than of limiting masses — which is exactly the
   * kind of number that reads as physics and is not. Every value below is a real
   * inversion, and the ordering is strictly monotonic in effective wavelength. */
  const LIMIT = 18;
  const ORDER = ["HST_F275W", "U", "V", "LSST_r", "K", "JWST_F200W"];
  const limMass = ORDER.map((id) => massForMagnitudeLimit(LIMIT, PASSBANDS[id], D));
  ok(
    limMass.every((m) => m > MASS_SEARCH_MIN && m < MASS_SEARCH_MAX),
    `at m = ${LIMIT} every band inverts to a real mass, none saturated`,
  );
  for (let i = 1; i < ORDER.length; i++) {
    ok(
      limMass[i] < limMass[i - 1],
      `${ORDER[i]} is complete to a lower mass than ${ORDER[i - 1]} (${limMass[i].toFixed(3)} vs ${limMass[i - 1].toFixed(3)} Msun)`,
    );
  }
  ok(
    limMass[0] / limMass[limMass.length - 1] > 4,
    `the near-UV limiting mass is over 4x the near-IR one (${(limMass[0] / limMass[limMass.length - 1]).toFixed(1)}x)`,
  );

  // A 0.1 Msun star at 400 pc, band by band — the span that makes the filter matter.
  const mags = ["HST_F275W", "U", "V", "LSST_r", "Gaia_G", "K", "JWST_F200W"].map((id) =>
    magnitudeForMass(0.1, PASSBANDS[id], D),
  );
  const span = Math.max(...mags) - Math.min(...mags);
  ok(span > 8, `a 0.1 Msun star spans ${span.toFixed(1)} mag across the filter set`);

  /* Against Gaia's own published limit, which is the check a reader can follow: a
   * 0.1 Msun star at 400 pc is BELOW G = 20.7, so Gaia genuinely cannot see it. This
   * is the kind of statement the lab exists to make, and it must not silently become
   * false if a curve or a zero point moves. */
  ok(
    magnitudeForMass(0.1, PASSBANDS.Gaia_G, D) > 20.7,
    `a 0.1 Msun star at 400 pc falls below Gaia's G = 20.7 limit (G = ${magnitudeForMass(0.1, PASSBANDS.Gaia_G, D).toFixed(2)})`,
  );
  ok(
    magnitudeForMass(0.1, PASSBANDS.LSST_r, D) < 24.0,
    `…but sits above Rubin's single-visit r = 24.0 (r = ${magnitudeForMass(0.1, PASSBANDS.LSST_r, D).toFixed(2)})`,
  );
}

if (failures) {
  console.error(`\n✗ completeness — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ completeness ok");
