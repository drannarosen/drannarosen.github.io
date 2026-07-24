/*
 * blackbody/index.ts — the Planck function and its companions (Layer 0, pure).
 *
 * Filed as its own domain because a blackbody spectrum is wanted by more than
 * one consumer: colour (integrate against the CIE observer), photometry
 * (integrate against a passband), and dust/shell thermal work all start here.
 *
 * Units are CGS. Wavelengths are in cm to stay consistent with the rest of the
 * core; helpers are provided for nm, which is how band definitions are written.
 */

import { PLANCK_H_CGS, C_CM_S, K_B_CGS } from "../constants/index.ts";

/** Wavelength conversion: nanometres to centimetres. */
export const NM_TO_CM = 1e-7;

/**
 * Planck spectral radiance B_lambda(T) [erg s^-1 cm^-2 sr^-1 cm^-1]:
 *
 *     B = 2hc^2 / lambda^5 / (exp(hc / (lambda k T)) - 1)
 *
 * Returns 0 for non-positive inputs rather than NaN, so callers integrating over
 * a grid do not have to guard every sample.
 *
 * The exponent overflows for short wavelengths at low temperature (the Wien
 * tail), where the true value underflows to zero; `Math.expm1` keeps the
 * long-wavelength (Rayleigh-Jeans) end accurate, where hc/(lambda k T) is small
 * and `exp(x) - 1` would lose most of its significant digits to cancellation.
 */
export function planckLambda(lambdaCm: number, temperatureK: number): number {
  if (!(lambdaCm > 0) || !(temperatureK > 0)) return 0;
  const x = (PLANCK_H_CGS * C_CM_S) / (lambdaCm * K_B_CGS * temperatureK);
  if (x > 700) return 0; // exp overflows past ~709; the true radiance is ~0 here
  const denom = Math.expm1(x);
  if (!(denom > 0)) return 0;
  return (2 * PLANCK_H_CGS * C_CM_S * C_CM_S) / lambdaCm ** 5 / denom;
}

/** `planckLambda` with the wavelength given in nanometres. */
export function planckNm(lambdaNm: number, temperatureK: number): number {
  return planckLambda(lambdaNm * NM_TO_CM, temperatureK);
}

/**
 * Wien displacement constant b [cm K] — DERIVED, not typed.
 *
 * b = hc/(k x) where x = 4.965114231744276 solves x = 5(1 - e^-x). Deriving it
 * from the SI-exact constants means it cannot drift from them, and the solved
 * root carries its own definition rather than appearing as a magic 0.2897771955.
 */
const WIEN_X = 4.965114231744276;
export const WIEN_B_CM_K = (PLANCK_H_CGS * C_CM_S) / (K_B_CGS * WIEN_X);

/** Wavelength [cm] of peak spectral radiance for a blackbody at T: lambda_max = b/T. */
export function wienPeakLambda(temperatureK: number): number {
  return temperatureK > 0 ? WIEN_B_CM_K / temperatureK : 0;
}
