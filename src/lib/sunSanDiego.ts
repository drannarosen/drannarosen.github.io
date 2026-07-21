/*
 * sunSanDiego.ts — where the Sun is over San Diego, right now.
 *
 * One computed sentence on /now. It is fixed to San Diego rather than to the
 * visitor because it is a statement about where the work happens: it stays
 * true whoever is reading, and it needs no geolocation permission, no IP
 * lookup, and no third-party request.
 *
 * Low-precision solar position from the USNO/NOAA formulation (Astronomical
 * Almanac, "Approximate Solar Coordinates"), accurate to better than 0.01° in
 * declination over 1950–2050 — some three orders of magnitude finer than the
 * whole-degree altitude this reports. Refraction is deliberately NOT applied:
 * the numbers here describe geometric altitude, and twilight is defined
 * geometrically at −18° anyway.
 *
 * Validated against the NOAA Solar Calculator in scripts/check-sun.mjs.
 */

/** San Diego State University, to the nearest hundredth of a degree. */
export const SAN_DIEGO = { latDeg: 32.78, lonDeg: -117.07 } as const;

const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

/** Days since J2000.0 (2000 Jan 1, 12:00 UT). */
export const daysSinceJ2000 = (date: Date) =>
  date.getTime() / 86_400_000 - 10_957.5;

export interface SunPosition {
  /** Geometric altitude above the horizon, degrees. Negative below. */
  altitudeDeg: number;
  /** Apparent declination, degrees. */
  declinationDeg: number;
  /** Local hour angle, degrees, in (−180, 180]. Negative before local noon. */
  hourAngleDeg: number;
}

/**
 * Solar altitude for a site at a moment.
 *
 * sin(alt) = sinφ sinδ + cosφ cosδ cos H — the spherical-triangle relation
 * between the observer's zenith, the pole, and the Sun.
 */
export function sunPosition(
  date: Date,
  latDeg: number = SAN_DIEGO.latDeg,
  lonDeg: number = SAN_DIEGO.lonDeg,
): SunPosition {
  const n = daysSinceJ2000(date);

  const meanLon = 280.46 + 0.9856474 * n; // deg
  const meanAnom = 357.528 + 0.9856003 * n; // deg
  // Equation of centre, truncated after the second term.
  const eclipticLon = meanLon + 1.915 * sin(meanAnom) + 0.02 * sin(2 * meanAnom);
  const obliquity = 23.439 - 0.0000004 * n;

  const declinationDeg = Math.asin(sin(obliquity) * sin(eclipticLon)) / RAD;
  const rightAscDeg =
    Math.atan2(cos(obliquity) * sin(eclipticLon), cos(eclipticLon)) / RAD;

  // Greenwich mean sidereal time, hours.
  const gmstHours = 18.697375 + 24.065709824419 * n;
  const localSiderealDeg = (gmstHours * 15 + lonDeg) % 360;

  // Wrap into (−180, 180] so "before/after local noon" reads off the sign.
  let hourAngleDeg = (((localSiderealDeg - rightAscDeg) % 360) + 540) % 360 - 180;

  const altitudeDeg =
    Math.asin(
      sin(latDeg) * sin(declinationDeg) +
        cos(latDeg) * cos(declinationDeg) * cos(hourAngleDeg),
    ) / RAD;

  return { altitudeDeg, declinationDeg, hourAngleDeg };
}

/**
 * Hours from `date` until the Sun next crosses `targetAltDeg` going downward
 * (dusk) — or null when it never reaches that altitude on this date, which is
 * how polar summer and, for −18°, high-latitude June behave.
 *
 * cos H = (sin(alt) − sinφ sinδ) / (cosφ cosδ) gives the opening estimate and,
 * crucially, decides whether a crossing exists at all. It is only an estimate:
 * it assumes δ is fixed and that the Sun's hour angle advances at a constant
 * rate, and neither holds well enough. Converting the hour-angle gap at the
 * SIDEREAL rate (15.041°/h) rather than the solar one put every answer about
 * 0.25° of altitude early — roughly a minute — because over an eight-hour gap
 * that 0.041°/h difference accumulates to a third of a degree. The equation of
 * time moves it further still.
 *
 * So the estimate is refined by Newton's method on the actual altitude
 * function, which is subject to none of those assumptions. Near the horizon
 * the derivative is a well-behaved ~12°/h, so three steps converge far inside
 * the minute this is rounded to. The check script verifies the returned time
 * really does have the Sun at the requested altitude.
 */
export function hoursUntilDusk(
  date: Date,
  targetAltDeg: number,
  latDeg: number = SAN_DIEGO.latDeg,
  lonDeg: number = SAN_DIEGO.lonDeg,
): number | null {
  const { declinationDeg, hourAngleDeg } = sunPosition(date, latDeg, lonDeg);

  const cosH =
    (sin(targetAltDeg) - sin(latDeg) * sin(declinationDeg)) /
    (cos(latDeg) * cos(declinationDeg));
  if (cosH < -1 || cosH > 1) return null; // never reaches that altitude today

  // Evening root: positive hour angle. If it has already passed today, the
  // next crossing is tomorrow's, a full rotation later.
  let deltaDeg = Math.acos(cosH) / RAD - hourAngleDeg;
  if (deltaDeg < 0) deltaDeg += 360;
  let hours = deltaDeg / 15; // mean solar rate — an opening guess only

  const altAt = (h: number) =>
    sunPosition(new Date(date.getTime() + h * 3_600_000), latDeg, lonDeg).altitudeDeg;

  const EPS = 1 / 120; // half a minute, in hours, for the numerical derivative
  for (let step = 0; step < 3; step++) {
    const slope = (altAt(hours + EPS) - altAt(hours - EPS)) / (2 * EPS);
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-6) break;
    hours -= (altAt(hours) - targetAltDeg) / slope;
  }

  return hours;
}
