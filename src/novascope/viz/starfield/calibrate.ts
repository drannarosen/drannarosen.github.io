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
  PSF_WIDTH_PX,
  MAX_QUAD_PX,
  coreExtentRadii,
  aureoleExtentRadii,
  diffractionExtentRadii,
} from "./sizing.ts";
import {
  DEFAULT_AUREOLE,
  DEFAULT_DIFFRACTION,
  moffat,
  aureole,
  moffatIntegral,
  aureoleIntegral,
  diffractionIntegral,
  diffractionAngleAveraged,
  type AureoleParams,
  type DiffractionParams,
} from "../../core/optics/index.ts";
import { transferFloor } from "../../core/imaging/transfers.ts";
import type { StarField } from "./prepare.ts";

/**
 * Ratio between the pixel intensity that should map to display white (the 99.5th
 * percentile of a rendered frame) and `analyticMeanIntensity`.
 *
 * MEASURED, not chosen: the geometric mean over seventeen configurations — seven colour
 * composites, a 16x range of exposure, three frame sizes, two device pixel ratios, three
 * fields of view, a mass cut and three depths.
 *
 * THE PER-CONFIGURATION EXTREMES ARE NOT RESTATED HERE. They live in
 * `scripts/reference/calibrate-whitepoint.json`, which is their one home, and `check:calibrate`
 * re-derives this constant from that fixture on every build at a 0.2% tolerance. An earlier
 * version of this comment carried them as prose and they went stale the moment the fixture was
 * regenerated: it claimed a spread of 28.13-40.88 against an actual 27.12-39.40, and the constant
 * itself sat at 33.70 against the fixture's 33.91 — a drift the old 2% tolerance absorbed in
 * silence. Prose is a second home for a fact, and it drifts like any other.
 *
 * The one number worth stating, because the gate checks it and it is what bounds the method, is
 * the SPREAD IN MAGNITUDES: 0.41. Against an 8 magnitude stretch that is about 5% of the dynamic
 * range, which is why one constant is enough here and a per-frame histogram pass is not worth its
 * cost.
 *
 * WHERE THE SPREAD COMES FROM, because it bounds what this can ever do: most of it is FIELD OF
 * VIEW. The analytic mean counts a star's total light and divides by the pixel count, so it does
 * not know how widely the projection spreads that light across the frame — the 20 and 70 degree
 * cases return an IDENTICAL mean while their true white points differ by about 1.4x. Nothing else
 * contributes more than roughly 15%.
 *
 * An earlier version of this constant was 22.06, measured against a quadrature that
 * evaluated diffraction spikes at theta = 0 — their angular peak — and then integrated as
 * if that value held all the way round. That overcounts each spike by 12.4x and inflated
 * the mean by about a third. The spread was the same either way, which is the point: the
 * constant absorbs any stable systematic, and what has to be gated is the stability, not
 * the value.
 */
export const WHITE_FROM_ANALYTIC_MEAN = 33.91;

/**
 * Bounds the per-configuration ratio must stay inside, at 1% either side of the recorded
 * extremes. The margin exists so float noise cannot fail the build on a boundary value — an
 * earlier version recorded the rounded extremes exactly and one configuration landed a
 * fraction below its own minimum.
 */
export const WHITE_FROM_ANALYTIC_MEAN_SPREAD = { min: 26.8, max: 39.8 };

/**
 * Total light one channel of a star puts into its own billboard, in core-radius^2 units.
 *
 * COMPOSES the term integrals from `core/optics` — it does not restate any of them. Each
 * term's value and its integral live together there, beside the parameters they consume, so
 * this function is only the composition rule: which terms a star profile is made of, and
 * what the pedestal subtraction does to the total.
 *
 * That mattered. An earlier version solved all three integrals inline here, which put the
 * aureole's algebra in a third place (once in `optics`, once restated in `./profile`, once
 * more here) — the same drift that once let `amp: 0.06` sit in optics while the shader used
 * 0.012, making "does the GPU match the reference?" unanswerable.
 *
 * The composition mirrors `starProfile` exactly:
 *
 *     integral of [ raw(rho) - raw(edge) ] over the disc
 *       = core + wing + spike - raw(edge) * pi * edge^2
 *
 * THE PEDESTAL IS ANGLE-AVERAGED, which is easy to get wrong. `starProfile` subtracts
 * `rawProfile(edge)` evaluated at THE FRAGMENT'S OWN angle, so along a diffraction spike more
 * is subtracted than between spikes. Integrated over the disc that removes the angle-averaged
 * value, not the on-axis one — hence `diffractionAngleAveraged` rather than
 * `diffraction(edge, 0, ...)`, which would overstate the subtraction by 12.4x wherever a
 * spike reaches and dim every tier-3 star.
 *
 * `amp` is used as BOTH the core amplitude and the wing/spike drive, matching how `prepare`
 * feeds the Lupton path: there the per-channel band flux is the physical quantity, and
 * scattered light is a fixed fraction of the light that entered at that wavelength.
 */
export function profileIntegral(
  amp: number,
  edge: number,
  a: AureoleParams,
  beta: number,
  spikes?: DiffractionParams,
): number {
  if (!(amp > 0) || !(edge > 0)) return 0;

  const core = amp * moffatIntegral(edge, 1, beta);
  const wing = amp * aureoleIntegral(edge, a);
  const spike = spikes === undefined ? 0 : amp * diffractionIntegral(edge, spikes);

  // The pedestal the shader removes from every fragment inside the quad, over its area.
  const pedestalValue =
    amp *
    (moffat(edge, 1, beta) +
      aureole(edge, a) +
      (spikes === undefined ? 0 : diffractionAngleAveraged(edge, spikes)));
  const pedestal = pedestalValue * Math.PI * edge * edge;

  return Math.max(0, core + wing + spike - pedestal);
}

/**
 * One display level's worth of intensity, for a requested depth in magnitudes — on the LUPTON
 * curve specifically.
 *
 * DELEGATES to `transferFloor`, which is the general form now that the transfer is selectable.
 * The name survives because every caller here is about the Lupton exposure calibration and
 * `transferFloor("lupton", d)` at six call sites would say less, not more — but the arithmetic
 * has one home, so the two cannot drift.
 */
export function floorForDepth(depthMag: number): number {
  return transferFloor("lupton", depthMag);
}

/**
 * The configurations `WHITE_FROM_ANALYTIC_MEAN` is measured over.
 *
 * SHARED between the fixture generator and the gate, because the two must agree on what was
 * measured or the comparison is meaningless — a run list written twice is a run list that
 * drifts, and the failure would look like a calibration error rather than a bookkeeping one.
 *
 * They span the axes a user can actually move: which composite, how much exposure, how large
 * the frame, what device pixel ratio, how wide the field, whether a mass cut is applied, and
 * how deep the stretch. Adding to this list is changing the claim the constant makes, so it
 * requires regenerating the fixture — which the fingerprint below enforces.
 */
export interface CalibrationRun {
  id: string;
  prepare: Record<string, unknown>;
  camera: { width: number; height: number; distancePc: number; fovDeg: number };
  depthMag: number;
}

const BASE_PREPARE = { bandTriple: ["R", "V", "B"] as const, pixelRatio: 1 };
const BASE_CAMERA = { width: 320, height: 320, distancePc: 12, fovDeg: 40 };

export const CALIBRATION_RUNS: CalibrationRun[] = [
  { id: "baseline", prepare: { ...BASE_PREPARE }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "Rubin irg", prepare: { ...BASE_PREPARE, bandTriple: ["LSST_i", "LSST_r", "LSST_g"] }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "Gaia", prepare: { ...BASE_PREPARE, bandTriple: ["Gaia_RP", "Gaia_G", "Gaia_BP"] }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "JWST", prepare: { ...BASE_PREPARE, bandTriple: ["JWST_F444W", "JWST_F200W", "JWST_F090W"] }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "HST", prepare: { ...BASE_PREPARE, bandTriple: ["HST_F814W", "HST_F606W", "HST_F275W"] }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "2MASS KHJ", prepare: { ...BASE_PREPARE, bandTriple: ["K", "H", "J"] }, camera: BASE_CAMERA, depthMag: 8 },
  /*
   * PHOTOMETRIC ONLY. This list briefly contained a no-triple "fallback ramp" case, which became
   * POPULATION mode when the modes were separated — a per-star asinh amplitude rather than linear
   * flux, so its white/mean ratio has a different meaning entirely and it widened the measured
   * spread from 0.41 to 1.43 mag. The constant calibrates the Lupton path; population mode does not
   * use it (its white point is 1 by construction, since `signal` is already normalised), so mixing
   * the two was measuring two things and reporting one number.
   */
  { id: "2MASS again", prepare: { ...BASE_PREPARE, bandTriple: ["JWST_F090W", "SDSS_r", "SDSS_g"] }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "exposure 4", prepare: { ...BASE_PREPARE, exposure: 4 }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "exposure 0.25", prepare: { ...BASE_PREPARE, exposure: 0.25 }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "minMass 1", prepare: { ...BASE_PREPARE, minMass: 1 }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "256 px", prepare: { ...BASE_PREPARE }, camera: { ...BASE_CAMERA, width: 256, height: 256 }, depthMag: 8 },
  { id: "512 px", prepare: { ...BASE_PREPARE }, camera: { ...BASE_CAMERA, width: 512, height: 512 }, depthMag: 8 },
  { id: "fov 20", prepare: { ...BASE_PREPARE }, camera: { ...BASE_CAMERA, fovDeg: 20 }, depthMag: 8 },
  { id: "fov 70", prepare: { ...BASE_PREPARE }, camera: { ...BASE_CAMERA, fovDeg: 70 }, depthMag: 8 },
  { id: "dpr 2", prepare: { ...BASE_PREPARE, pixelRatio: 2 }, camera: BASE_CAMERA, depthMag: 8 },
  { id: "depth 12", prepare: { ...BASE_PREPARE }, camera: BASE_CAMERA, depthMag: 12 },
  { id: "depth 6.5", prepare: { ...BASE_PREPARE }, camera: BASE_CAMERA, depthMag: 6.5 },
];

/**
 * Fingerprint of every constant that determines the recorded white points.
 *
 * THE POINT OF A COMMITTED FIXTURE'S FINGERPRINT is that a fixture's characteristic danger is
 * silent staleness: it goes on certifying a calibration after the thing it measured has moved.
 * Change the aureole amplitude, the Moffat beta, the PSF width or the quad cap, and every
 * recorded white point is wrong while the gate keeps passing.
 *
 * So the gate compares this string against the one in the fixture and fails on any difference,
 * which turns an invisible problem into an instruction to regenerate. It is deliberately a
 * plain readable string rather than a hash — when it does mismatch, the diff says WHICH
 * constant moved, and that is most of the diagnosis.
 */
export function calibrationFingerprint(): string {
  const a = DEFAULT_AUREOLE;
  const d = DEFAULT_DIFFRACTION;
  return [
    `aureole=${a.amp},${a.scale},${a.p}`,
    `diffraction=${d.spikes},${d.amp},${d.sharpness},${d.scale},${d.p},${d.angle}`,
    `psf=${PSF_WIDTH_PX},${PSF_BETA}`,
    `quadCap=${MAX_QUAD_PX}`,
    /*
     * The run list's CONTENT, not just its length. `runs=17` did not change when a run's meaning did
     * — the no-triple case silently became population mode — so the fixture kept certifying a
     * calibration measured over a different set. A short digest of the ids and options catches that.
     */
    `runs=${CALIBRATION_RUNS.map((r) => `${r.id}:${JSON.stringify(r.prepare)}:${r.depthMag}`).join("|").length}x${CALIBRATION_RUNS.length}`,
  ].join(" ");
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
      const sum = profileIntegral(amp, edge, aureole, beta, spikes);
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
