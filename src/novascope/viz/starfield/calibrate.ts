/*
 * calibrate.ts — what intensity should map to display white (Layer 2).
 *
 * The Lupton path compresses ONCE PER PIXEL, after the radiances of every star have been
 * summed. That is correct, and it creates a problem the per-star path never had: the
 * transfer needs to know the scale of the PIXEL intensities, and those are not the star
 * intensities.
 *
 * Measured on the shipped cluster: the per-star normalization in `prepare` puts the 99.5th
 * percentile of per-star intensity at exactly 1 by construction, but a pixel sums the
 * wings of thousands of stars, so the background sits at 3.3e-3 against a median star's
 * own peak contribution of 2.3e-6 — 1400x brighter than the thing the white point was
 * calibrated against. Feeding per-star-normalized values to a deep stretch put the whole
 * frame above 64/255.
 *
 * This is exactly why `astropy.visualization.make_lupton_rgb` takes IMAGES rather than a
 * source catalogue: the interval is a property of the rendered pixels.
 *
 * THREE WAYS TO GET IT, and why this is the third.
 *
 *   1. Rasterise on the CPU and take a percentile. Correct, and far too slow — the CPU
 *      reference exists for verification, not for every control change.
 *   2. Reduce on the GPU. Correct, but a percentile needs a sort or a histogram, so it
 *      means a real extra pass and a frame of readback latency for a number that barely
 *      moves.
 *   3. Compute the mean ANALYTICALLY from the same per-star quantities the GPU already
 *      receives, and scale it by a measured constant. No rasterisation, no reduction, no
 *      latency: total light over pixel count, in closed form, a few dozen flops per star.
 *
 * The mean is then exact. What is approximate is the step from mean to percentile, and that
 * is the constant below — measured rather than assumed, with its spread stated and gated.
 */

import {
  PSF_BETA,
  MAX_QUAD_PX,
  coreExtentRadii,
  aureoleExtentRadii,
  diffractionExtentRadii,
} from "./sizing.ts";
import {
  DEFAULT_AUREOLE,
  DEFAULT_DIFFRACTION,
  type AureoleParams,
  type DiffractionParams,
} from "../../core/optics/index.ts";
import type { StarField } from "./prepare.ts";

/**
 * Ratio between the pixel intensity that should map to display white (the 99.5th
 * percentile of a rendered frame) and `analyticMeanIntensity`.
 *
 * MEASURED, not chosen: 34.92 is the geometric mean over seventeen configurations — seven
 * colour composites, a 16x range of exposure, three frame sizes, two device pixel ratios,
 * three fields of view, a mass cut and three depths. The full spread is 28.13 to 40.88, a
 * factor of 1.45, which is 0.41 magnitudes.
 *
 * 0.41 mag of white-point uncertainty against an 8 magnitude stretch is about 5% of the
 * dynamic range, which is why one constant is enough here and a histogram pass is not
 * worth its cost. `check:calibrate` re-measures the spread and fails if it widens, so this
 * is a bounded approximation rather than a lucky fit.
 *
 * WHERE THE SPREAD COMES FROM, stated because it bounds what this can ever do: most of it
 * is FIELD OF VIEW (29.70 at 20 degrees against 40.88 at 70). The analytic mean counts a
 * star's total light and divides by the pixel count, so it does not know how widely the
 * projection spreads that light across the frame — the two fov cases return an identical
 * mean while their true white points differ by a factor of 1.38. Nothing else contributes
 * more than about 15%.
 *
 * An earlier version of this constant was 22.06, measured against a quadrature that
 * evaluated diffraction spikes at theta = 0 — their angular peak — and then integrated as
 * if that value held all the way round. That overcounts each spike by 12.4x and inflated
 * the mean by about a third. The spread was the same either way, which is the point: the
 * constant absorbs any stable systematic, and what has to be gated is the stability, not
 * the value.
 */
export const WHITE_FROM_ANALYTIC_MEAN = 34.92;

/** Configurations the constant above was measured over, for the gate to reproduce. */
export const WHITE_FROM_ANALYTIC_MEAN_SPREAD = { min: 27.9, max: 41.2 };

/**
 * Integral of one channel's star profile over its quad, in core-radius^2 units.
 *
 * The closed form of what `starProfile` draws — core plus aureole, minus the pedestal that
 * the shader subtracts at the quad edge — for a single amplitude `amp` used as both the core
 * amplitude and the aureole drive, matching how `prepare` feeds the Lupton path.
 *
 * The diffraction spike is deliberately absent; see the note on `analyticMeanIntensity`.
 *
 * `p === 1` and `p === 2` are singular in the wing's antiderivative and are rejected rather
 * than special-cased: the shipped aureole uses p = 3 and no configuration in this repository
 * comes near either, so a branch for them would be untested code guarding an input that
 * cannot arrive. Returning the core alone would silently under-report; NaN would propagate
 * into the white point and blank the frame. So it throws, loudly, at the one place that
 * could ever produce it.
 */
export function profileIntegral(
  amp: number,
  edge: number,
  a: AureoleParams,
  beta: number,
): number {
  if (!(amp > 0) || !(edge > 0)) return 0;
  const e2 = edge * edge;

  // Core: A pi / (beta - 1) * [1 - (1 + E^2)^(1 - beta)]
  const core = ((amp * Math.PI) / (beta - 1)) * (1 - (1 + e2) ** (1 - beta));

  // Wing: substitute u = 1 + rho/s, so 2 pi rho drho = 2 pi s^2 (u - 1) du.
  let wing = 0;
  if (a.scale > 0 && a.p > 0) {
    if (a.p === 1 || a.p === 2) {
      throw new Error(`aureole exponent p = ${a.p} is singular in the closed-form integral`);
    }
    const U = 1 + edge / a.scale;
    wing =
      a.amp *
      amp *
      2 *
      Math.PI *
      a.scale *
      a.scale *
      ((U ** (2 - a.p) - 1) / (2 - a.p) - (U ** (1 - a.p) - 1) / (1 - a.p));
  }

  // Pedestal: the shader subtracts the raw profile's value at the edge, everywhere inside.
  const rawAtEdge =
    amp * (1 + e2) ** -beta + (a.scale > 0 ? (a.amp * amp) / (1 + edge / a.scale) ** a.p : 0);
  const pedestal = rawAtEdge * Math.PI * e2;

  return Math.max(0, core + wing - pedestal);
}

export interface CalibrateOptions {
  aureole?: AureoleParams;
  diffraction?: DiffractionParams;
  beta?: number;
  /** Intensity one display level corresponds to — sets how far each quad reaches. */
  floor: number;
}

/**
 * Mean pixel intensity of the frame this field would render to — total light over pixel
 * count, with no rasterisation.
 *
 * Each star's contribution is the integral of its own profile over its own quad:
 *
 *     L = psf^2 * integral over [0, edge] of profile(rho) * 2 pi rho drho
 *
 * IT IS SOLVED IN CLOSED FORM, not quadratured, and that is a correctness fix as much as a
 * speed one. The first version sampled uniformly in rho, which is badly wrong here: the
 * Moffat core holds most of its energy inside rho ~ 2 while `edge` runs to 28 core radii
 * for a bright star, so 64 uniform samples gave the core about two points and came out 4%
 * off — while an earlier version of this comment claimed better than 0.1%. The gate caught
 * that. Substituting `1 + rho^2 = exp(v)` fixed the accuracy but cost 361 ms per call,
 * which is far too slow for a recalibration on every control change.
 *
 * Both terms integrate exactly:
 *
 *     core:  A pi / (beta - 1) * [1 - (1 + E^2)^(1 - beta)]
 *     wing:  amp D 2 pi s^2 * [ (U^(2-p) - 1)/(2-p) - (U^(1-p) - 1)/(1-p) ],  U = 1 + E/s
 *     pedestal: -raw(E) * pi E^2
 *
 * Verified against a 200,000-sample quadrature of the same terms to 1.5e-9, and the whole
 * calibration drops from 361 ms to a few milliseconds.
 *
 * THE COST OF THE CLOSED FORM is that the profile's algebra now appears here as well as in
 * `./profile`, which is exactly the duplication this codebase avoids elsewhere. The
 * mitigation is that the two are INDEPENDENT derivations of different quantities — a
 * profile and its integral — and `check:calibrate` gates them equal against a quadrature of
 * `starProfile` itself. Two derivations that must agree is a stronger position than one
 * that cannot be checked.
 *
 * TWO APPROXIMATIONS REMAIN, both deliberate:
 *   - Stars whose quads fall partly outside the frame are counted in full, so the mean is
 *     an overestimate. Measured at a near-constant factor across every configuration
 *     tried, which is why it can be absorbed into the constant rather than modelled.
 *   - Diffraction spikes are OMITTED, and absorbed into the constant. They are a tier-3
 *     artifact (~0.5% of stars) whose azimuthal mean is only 0.081 of their peak, so
 *     including them correctly would need that angular factor; including them at their peak,
 *     as an earlier version did, overcounts by 12.4x.
 */
export function analyticMeanIntensity(
  field: StarField,
  widthPx: number,
  heightPx: number,
  opts: CalibrateOptions,
): number {
  if (!(widthPx > 0) || !(heightPx > 0)) return 0;
  const aureole = opts.aureole ?? DEFAULT_AUREOLE;
  const spikeParams = opts.diffraction ?? DEFAULT_DIFFRACTION;
  const beta = opts.beta ?? PSF_BETA;
  const psf = field.stats.psfWidthPx;
  let total = 0;

  for (let i = 0; i < field.count; i++) {
    const f0 = field.bandFlux[i * 3] ?? 0;
    const f1 = field.bandFlux[i * 3 + 1] ?? 0;
    const f2 = field.bandFlux[i * 3 + 2] ?? 0;
    const peak = Math.max(f0, f1, f2);
    if (!(peak > 0)) continue;

    const spikes = (field.tier[i] ?? 1) >= 3 ? spikeParams : undefined;
    const halfPx = Math.min(
      MAX_QUAD_PX,
      psf *
        Math.max(
          coreExtentRadii(peak, opts.floor, beta),
          aureoleExtentRadii(peak, aureole),
          spikes ? diffractionExtentRadii(peak, spikes) : 0,
        ),
    );
    if (!(halfPx > 0)) continue;
    const edge = halfPx / psf;

    for (let k = 0; k < 3; k++) {
      const amp = field.bandFlux[i * 3 + k] ?? 0;
      if (amp <= 0) continue;
      const sum = profileIntegral(amp, edge, aureole, beta);
      // /3 because Lupton's intensity is the MEAN of the three channels, not their sum.
      total += (sum * psf * psf) / 3;
    }
  }
  return total / (widthPx * heightPx);
}

/**
 * The pixel intensity that should map to display white, for this field at this frame size.
 *
 * `analyticMeanIntensity` times the measured constant. This is the single number the
 * shader needs, so the whole per-pixel calibration reaches the GPU as one uniform.
 */
export function whitePixelIntensity(
  field: StarField,
  widthPx: number,
  heightPx: number,
  opts: CalibrateOptions,
): number {
  return WHITE_FROM_ANALYTIC_MEAN * analyticMeanIntensity(field, widthPx, heightPx, opts);
}
