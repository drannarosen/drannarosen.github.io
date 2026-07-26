/*
 * prepare.ts — turn a raw star export into GPU-ready arrays (Layer 2).
 *
 * The whole physics→pixel path runs HERE, on the CPU, in plain TypeScript: flux,
 * exposure, colour, core size and tier are all constant per star, so none of
 * them needs to be a shader. That is deliberate. It leaves the GPU with only the
 * one thing that genuinely varies across a billboard — the PSF profile — so the
 * un-unit-testable surface is two small functions rather than the entire
 * pipeline, and every colour scheme (including the band composites) works
 * without being ported to TSL.
 *
 * The maths itself lives in Layer 0 and is imported, never restated.
 */

import {
  deriveLogL,
  apparentFlux,
  D0_PC,
  distanceModulus,
  bolometricMagnitude,
  magnitudeDifference,
  fluxRatioForMagnitudes,
} from "../../core/photometry/index.ts";
import {
  PASSBANDS,
  bandFlux,
  absoluteAbMagnitude,
  abMagnitude,
  type Passband,
} from "../../core/photometry/passbands.ts";
import { massForMagnitudeLimit, MASS_SEARCH_MIN } from "../../core/photometry/completeness.ts";
import { bandIntegral, VEGA_TEFF_K } from "../../core/photometry/passbands.ts";
import { planckNm } from "../../core/blackbody/index.ts";
import {
  robustWhiteFlux,
  asinhResponse,
  VISIBILITY_THRESHOLD,
  limitingFluxRatio,
  softeningForLimit,
} from "../../core/imaging/index.ts";
import { getScheme } from "../../core/colorimetry/schemes.ts";
import {
  DEFAULT_AUREOLE,
  DEFAULT_DIFFRACTION,
  type AureoleParams,
  type DiffractionParams,
} from "../../core/optics/index.ts";
import { unitLuminanceChroma } from "../../core/colorimetry/index.ts";
import {
  computeTiers,
  PSF_WIDTH_PX,
  MAX_QUAD_PX,
  coreExtentRadii,
  aureoleExtentRadii,
  diffractionExtentRadii,
  type TierBoundaries,
} from "./sizing.ts";
import {
  DEFAULT_LUPTON_DEPTH_MAG,
  DEFAULT_POPULATION_DEPTH_MAG,
} from "../../core/imaging/lupton.ts";
import { transferFloor, type TransferId } from "../../core/imaging/transfers.ts";

/**
 * Floats per star in the packed table this module reads, in the order
 * `[x, y, z, mass, teff, radius]`.
 *
 * A neutral struct-of-floats sized for a GPU upload — NOT a file format. Where
 * the rows come from is a scientific choice and lives in `./source`, which is
 * also where the record of why one particular producer is unusable is kept.
 */
export const STAR_STRIDE = 6;

export interface PrepareOptions {
  /** Colour scheme id (see core/colorimetry/schemes). */
  scheme?: string;
  /**
   * Photometric band that sets APPARENT BRIGHTNESS. Omit for bolometric.
   *
   * Using a band is the physically correct choice for an image: a camera records
   * what passes its filter, and only ~16% of a 3200 K star's light reaches the
   * visible band against ~53% of the Sun's. Bolometric is kept selectable
   * because it is the honest "total energy" view, not because it looks right.
   */
  band?: string;
  /** Percentile mapped to display white. */
  whitePercentile?: number;
  /** asinh softening: roughly log10(k) dex of faint detail revealed. */
  softening?: number;
  /**
   * How deep the exposure reaches, in MAGNITUDES below the display white point.
   *
   * The physical way to say the same thing `softening` says opaquely: this is a
   * statement about an observation, so it can be reported, checked and compared,
   * where `k = 3e7` can only be tuned. When set it DERIVES `softening` and wins
   * over it. (`3e7` turns out to mean 19.78 mag, which is a very deep stretch —
   * worth knowing rather than discovering.)
   */
  starDepthMag?: number;
  /**
   * How many magnitudes below white the PER-PIXEL transfer curve spans.
   *
   * The other half of what `depthMag` used to mean. Consumed only by transfers whose shape moves
   * with depth — in practice `lupton`, whose Q this sets — and by the display floor that sizes
   * each star's billboard. Every other transfer has a fixed shape and ignores it.
   *
   * SPLIT FROM `starDepthMag` BECAUSE ONE NAME FOR TWO PARAMETERS HAS COST REAL BUGS. As
   * `depthMag` it drove the per-star asinh softening AND Lupton's per-pixel Q, and the two want
   * different values: sharing one number put the median star's display signal at 1e-4 against a
   * 0.02 threshold, so only the hot blue stars survived and the field read as a single colour
   * (fixed in 778a91b). It then caused a second, different bug in the URL layer, where a
   * mode-dependent default could not be encoded and a shared link silently reopened at another
   * depth. Two parameters, two names, no shared default to get wrong.
   */
  pixelDepthMag?: number;
  /**
   * Lower mass cut [Msun]. Stars below it are computed but not shown.
   *
   * A MODELLING selection, not an observational one, and kept distinct from
   * `depthMag` for that reason: depth is a property of the instrument, a mass cut
   * is a decision about which stars to count. Presenting a mass-cut image as "the
   * cluster" would be a claim about the cluster that the cut itself falsifies, so
   * a consumer showing this must say the population is filtered.
   *
   * The white point is deliberately still computed over the FULL population, so
   * the cut changes which stars you see and not how bright the rest are. Otherwise
   * removing the faint majority would silently re-expose the image and there would
   * be nothing to compare.
   */
  minMass?: number;
  /**
   * DETECTION LIMIT: apparent AB magnitude in the selected band, beyond which a star
   * is not detected at all. Ignored without a band, because a bolometric view is not
   * something an instrument has a limiting magnitude for.
   *
   * THIS IS WHAT MAKES THE BAND CONTROL VISIBLE, and it is a different mechanism from
   * `depthMag` on purpose.
   *
   * `depthMag` and `whitePercentile` are TONE MAPPING: they describe how the recorded
   * flux is spread across the display, and the white point is a percentile of whatever
   * band is showing. That is a legitimate and standard choice — an astronomical image
   * is scaled to its own data — but it means switching band multiplies every flux by
   * roughly the same factor, the white point follows, and the band cancels out of its
   * own display. Measured: across 271 nm to 7.7 um the largest change in the normalised
   * image was 3.3% RMS. The physics was never subtle (a 0.1 Msun star at 400 pc spans
   * 11 magnitudes across these filters); the normalisation was hiding it.
   *
   * A detection limit is not tone mapping. It is an absolute statement about the
   * instrument, so it does NOT rescale with the band, and a star either clears it or
   * does not. Set it to Gaia's G = 20.7 and the low-mass majority genuinely disappears;
   * set it to Rubin's coadd r = 26.9 and it all comes back. That is the real difference
   * between those telescopes, and it is the thing the lab was failing to show.
   *
   * Like `minMass` this zeroes a star's signal rather than dropping it, so the white
   * point stays computed over the full population and the stars that survive keep the
   * brightness they had. Otherwise a shallow limit would re-expose the image and there
   * would be nothing to compare between instruments.
   */
  magLimit?: number;
  /**
   * Three band ids mapped to red, green and blue — an instrument's colour composite.
   *
   * When given, `bandFlux` carries three REAL band fluxes and the image's hue comes from
   * the physics of those filters. When omitted it falls back to the selected colour
   * scheme's hue times the single-band intensity, which is what the renderer does today
   * and is the honest "no instrument chosen" answer rather than a fabricated triple.
   *
   * Longest to shortest wavelength, matching `BandComposite`, so red really is the red
   * channel. Nothing here validates that ordering — `check:star-optics` does, because a
   * reversed composite produces a plausible image that is simply wrong.
   */
  bandTriple?: readonly [string, string, string];
  /**
   * Which claim the image is making. Defaults to `photometric` when a `bandTriple` is given and
   * `population` otherwise, so the two cannot disagree about what is being shown.
   *
   * `photometric` — three real band fluxes, LINEAR, hue from the flux ratios. What a camera
   *   records. Honest, and for a young cluster it comes out blue: 10 of these 10,000 stars carry
   *   48% of the light and 100 carry 92%, and those are the hot ones. Any hue-preserving display
   *   therefore goes blue, and that is the physics rather than a bug.
   *
   * `population` — hue from the colour scheme at UNIT LUMINANCE, brightness from the per-star
   *   asinh signal. NOT photometric, and the difference is the point: normalising every star's
   *   colour to unit luminance discards the flux ratios, so a faint red dwarf is as saturated as a
   *   bright blue giant. That is the only mode in which this cluster's colour diversity is visible
   *   — measured hue spread 0.082 with the `true` scheme and 0.150 with `stretched`, against 0.021
   *   photometric.
   *
   * Two modes rather than one compromise, because they are two different claims and a single image
   * cannot make both. A page showing `population` must not describe it as what a telescope sees.
   */
  colorMode?: "photometric" | "population";
  /**
   * Per-pixel display transfer. `lupton` is the three-channel hue-preserving one; the rest are the
   * scalar curves in `core/imaging/stretch`, applied to each channel.
   *
   * Defaults per mode, and the defaults are not interchangeable: `photometric` wants `lupton`
   * because its input is linear and uncompressed, while `population` wants `linear` because its
   * per-star signal is ALREADY asinh-compressed and a second curve on top would compress twice —
   * the same double-compression this whole restructuring removed from the overlap case.
   */
  scaling?: TransferId;
  /**
   * Sky level subtracted before the display transfer, as a FRACTION of the white point.
   *
   * What a real reduction pipeline does first, and what `minimum` in astropy's `make_lupton_rgb`
   * is for. The background in a rendered cluster is the summed wings of every star, so it is real
   * and it is blue — the light is dominated by hot stars — and any curve that lifts the faint end
   * lifts it too. Subtracting the median took a frame from 0.7% to 41% black, raised the hue spread
   * from 0.225 to 0.349, and cut the blue fraction from 0.249 to 0.148.
   *
   * DEFAULTS TO ZERO because the right value is not derivable here. It is a percentile of the
   * RENDERED pixels, and unlike the white point it is not a stable fraction of anything available
   * without them: measured across composites, frame sizes, fields of view and exposures it spans
   * 97x, against 1.45x for the white point. Anything else would be a fabricated default.
   *
   * Carried on `PrepareOptions` rather than passed straight to the renderer so one call describes
   * the whole image, and reported back in `stats` so a page can state what it did.
   */
  skyLevel?: number;
  /**
   * Measure the sky from the rendered frame instead of using `skyLevel`.
   *
   * Carried here, like `bloom`, so one options object still describes the whole image — `prepare`
   * itself does not consume it, because the measurement needs the frame and `prepare` runs before
   * there is one.
   */
  skyAuto?: boolean;
  /**
   * Strength of the scattered-light aureole, as a MULTIPLE of `DEFAULT_AUREOLE.amp`. 0 turns it
   * off; 1 is the shipped instrument.
   *
   * A multiplier rather than an amplitude, so the default lives in `core/optics` and this says
   * "more or less of that" instead of restating the number — the same discipline that keeps
   * `DEPTH_MAG_RANGE` out of the slider markup. Zero needs no separate toggle: `aureoleExtentRadii`
   * already returns 0 when the peak falls below the floor, so a strength of 0 removes the term from
   * the sizing and the shading by the same route it would take if the star were faint.
   */
  aureoleStrength?: number;
  /**
   * Strength of the diffraction spikes, as a multiple of `DEFAULT_DIFFRACTION.amp`. 0 turns them
   * off; 1 is the shipped instrument.
   *
   * Worth being able to turn off specifically. Spikes are the most recognisable instrument
   * signature there is, they are the thing most easily mistaken for a claim about the star, and
   * they were measured owning 58.2% of the drawn quad area from SEVEN stars of 1200 — so being
   * able to see the frame without them is the difference between judging the cluster and judging
   * the spider.
   */
  spikeStrength?: number;
  /**
   * Distance to the cluster CENTRE [pc]. Defaults to `D0_PC`.
   *
   * Rung 4 of the theory-to-observation ladder, and the rung where theory becomes observation:
   * before it every star sits at a common distance and you are looking at the population; after
   * it the inverse-square law applies WITHIN the cluster and you are looking at an image.
   *
   * It deliberately does not change the exposure. The white point is a percentile of the
   * resulting fluxes, so moving the whole cluster rescales every flux identically and cancels —
   * which is why the picture barely changes while the reported apparent magnitudes slide a long
   * way. Absolute magnitude does not move at all. That contrast IS the lesson, and it is only
   * legible because both numbers are already reported side by side.
   */
  distancePc?: number;
  /**
   * Bloom strength. 0 disables it.
   *
   * A control rather than a constant because it turned out to dominate a symptom I had blamed on the
   * display transfer: bloom keys on display white, the stars that overflow in a young cluster are the
   * hot blue ones, and their glow is spread across the whole frame — so the BACKGROUND takes their
   * hue. Measured mean blue fraction 0.75 with bloom against 0.15 for the same field in the CPU
   * reference, which differs from the live pipeline in exactly that one pass.
   *
   * Not consumed by `prepare` itself — it belongs to the pipeline — but carried here so one options
   * object still describes the whole image.
   */
  bloom?: number;
  /** Exposure multiplier. */
  exposure?: number;
  /** Tier percentile boundaries. */
  tiers?: TierBoundaries;
  /** Device pixel ratio — core sizes are authored in CSS px and scaled by it. */
  pixelRatio?: number;
}

export interface StarField {
  count: number;
  /** xyz per star [pc]. */
  position: Float32Array;
  /** Linear RGB per star, peak-normalized. */
  color: Float32Array;
  /** Display signal per star; 1 is white, above 1 is HDR overflow. */
  signal: Float32Array;
  /**
   * LINEAR flux in three bands per star, relative to the display white INTENSITY, times
   * exposure. Unbounded, uncompressed, vec3.
   *
   * THE INPUT TO A LUPTON MAPPING, and the channel that replaces the `color` + `signal`
   * pair. Those two decided hue and brightness separately, which is why a saturated star
   * drifted toward white and why choosing a filter never changed the colour of anything.
   * Here the three band fluxes carry both at once: their ratios are the hue, their mean
   * is the intensity, and `core/imaging/lupton` turns that into a pixel with the hue
   * preserved through saturation.
   *
   * DELIBERATELY UNCOMPRESSED, which also fixes a real bug rather than only enabling a
   * feature. `signal` has already been through the asinh transfer per STAR, so where two
   * stars overlap the renderer sums two already-compressed values — compressing twice and
   * getting a result that is not the transfer of the summed flux. Accumulating linear
   * radiance and compressing once per pixel at the end is both correct and what astropy
   * does.
   *
   * Emitted ALONGSIDE `signal` rather than replacing it, so this commit changes nothing
   * on screen and the two can be compared. The TSL graph switches over separately, once
   * the CPU reference has been shown to agree.
   */
  bandFlux: Float32Array;
  /**
   * LINEAR flux relative to the display white point, times exposure. Unbounded.
   *
   * What drives the scattered-light halo, and the reason it is a separate channel
   * from `signal`. Scattered light is a fixed fraction of the flux that actually
   * entered the instrument, so the halo belongs to the physics, while `signal` has
   * already been through the asinh transfer for DISPLAY. Driving the halo off
   * `signal` — as it was — made the halo inherit the compression, and that is what
   * flattened apparent size: measured across this population, `signal` spans a
   * factor of 3.1 from median to brightest while this spans 9.6e6 (7.0 dex). The
   * halo's threshold radius goes as drive^(1/p), so 7 dex gives ~90x of extent to
   * work with where the compressed signal gave 1.5x.
   */
  halo: Float32Array;
  /** Billboard half-extent per star [device px]; the PSF width is fixed. */
  sizePx: Float32Array;
  /**
   * The optics this field was SIZED with — the one record both consumers read.
   *
   * `starGraph` builds its uniforms from here rather than from `core/optics`'s defaults, so the
   * profile the shader evaluates is by construction the profile the quads were solved against.
   * See the resolution site in `prepareStarField` for why that coupling is load-bearing.
   *
   * `diffraction` is null when the spikes are off, which is a different statement from an
   * amplitude of zero: no spider at all, rather than a spider contributing nothing.
   */
  optics: {
    aureole: AureoleParams;
    diffraction: DiffractionParams | null;
  };
  /** Render tier per star (1, 2 or 3). */
  tier: Uint8Array;
  /** Diagnostics worth showing in a lab readout. */
  stats: {
    whiteFlux: number;
    /**
     * Stars whose display signal clears the visibility threshold.
     *
     * A property of the TRANSFER, not of the frame: a star far out in the
     * profile's tail counts here while being off-screen, so this is "above
     * threshold" and must not be reported as "visible on screen".
     */
    visible: number;
    clipping: number;
    tierCounts: [number, number, number];
    maxSizePx: number;
    psfWidthPx: number;
    /** Softening actually used, whether given directly or derived from `starDepthMag`. */
    softening: number;
    /** How deep this exposure reaches, in magnitudes below the white point. */
    /** Depth the PER-STAR curve reaches [mag below white] — what `softening` delivers. */
    depthMag: number;
    /** Depth the PER-PIXEL transfer curve spans [mag]. Only `lupton` varies with it. */
    pixelDepthMag: number;
    /**
     * Apparent BOLOMETRIC magnitude of the faintest star still above threshold, on
     * the IAU 2015 B2 scale. `Infinity` if nothing is visible.
     *
     * The absolute anchor for the depth, and bolometric because that is the only
     * magnitude scale with a zero point this package can state honestly — the
     * passbands are Vega-relative for colour indices only.
     */
    faintestVisibleMbol: number;
    /** Stars actually drawn, after any `minMass` cut. */
    shown: number;
    /**
     * Range of ABSOLUTE magnitude across the drawn population, in the selected
     * band's own system — AB when a band is chosen, IAU bolometric otherwise.
     *
     * A property of the STARS, not of the exposure or the framing, which is exactly
     * what makes it the useful teaching number: it does not move when the depth
     * slider or the camera does. `brightest` is the smallest (most negative).
     */
    absMag: { brightest: number; faintest: number; system: "AB" | "bolometric" };
    /** Which claim this field makes, RESOLVED — the defaults depend on whether a triple was given. */
    colorMode: "photometric" | "population";
    /** The per-pixel transfer this field expects, resolved the same way. */
    scaling: TransferId;
    /** Sky fraction subtracted before that transfer; 0 means none. */
    skyLevel: number;
    /** Distance to the cluster centre used for this field [pc]. */
    distancePc: number;
    /**
     * The instrument's detection limit, and what it implies — `null` without a
     * `magLimit`, or when no band is selected.
     *
     * `undetected` counts stars the limit removed, kept apart from the `minMass` cut
     * because a telescope failing to see a star and a modeller choosing not to count it
     * are different statements about the same image.
     *
     * `limitingMass` is the completeness limit DERIVED from that magnitude through
     * `core/photometry/completeness`, whose inverse is gated — so this number and the
     * "you need magnitude m to reach mass M" number on the page are the same relation
     * read in two directions rather than two calculations that can disagree. It is
     * quoted at the cluster's CENTRE distance, so it is a representative figure and not
     * a per-star truth; the near side of the cluster is complete slightly deeper.
     */
    detection: {
      magLimit: number;
      undetected: number;
      limitingMass: number;
      /** True when the limit is deeper than the model's own lowest mass. */
      complete: boolean;
    } | null;
  };
}

const DEFAULT_TIERS: TierBoundaries = { t2: 0.9, t3: 0.995 };

/**
 * Closest a star may be placed to the observer [pc].
 *
 * Only a guard against a divide-by-zero from an unbounded profile tail — a
 * Plummer sphere formally reaches any radius — not a physical horizon. Far below
 * any real cluster depth, so it never binds on a sane population.
 */
const MIN_DISTANCE_PC = 1;

/**
 * Population fraction mapped to display white.
 *
 * Kept HIGH, against the intuition that letting more stars overflow would give the
 * bright end more range to vary size with. Measured on a 10,000-star cluster, the
 * ratio of the brightest signal to the median — which is what apparent size keys
 * on — moves the WRONG way as the percentile drops:
 *
 *     0.995   max/p50 = 3.1      0.95   max/p50 = 2.2
 *     0.99    max/p50 = 2.9      0.90   max/p50 = 1.9
 *
 * because lowering the white point raises every signal, and asinh compresses
 * harder the larger its argument. So a lower percentile brightens the image and
 * FLATTENS it. The bright-end range has to come from somewhere the transfer has
 * not already compressed — which is why the halo is driven by linear flux instead
 * (see `halo` in StarField).
 */
const DEFAULT_WHITE_PERCENTILE = 0.995;

/** Resolve a band id, falling back to bolometric when unknown or absent. */
function resolveBand(id: string | undefined): Passband | null {
  if (!id || id === "bolometric") return null;
  return PASSBANDS[id] ?? null;
}

/**
 * Build the GPU arrays for a star field.
 *
 * `stars` is the packed table: `count * STAR_STRIDE` floats of
 * `[x, y, z, mass, teff, radius]` in `(pc, pc, pc, Msun, K, Rsun)`. Build one
 * with `./source`.
 */
export function prepareStarField(stars: Float32Array, opts: PrepareOptions = {}): StarField {
  const count = Math.floor(stars.length / STAR_STRIDE);
  const band = resolveBand(opts.band);
  const scheme = getScheme(opts.scheme ?? "true");
  /*
   * RESOLVED ONCE, HERE, because two things below need it and they must not disagree: the depth
   * fallback immediately after, and the display path further down. It used to be derived twice —
   * inline inside the `softening` ternary, and again as a named `colorMode` forty lines later.
   */
  const colorMode = opts.colorMode ?? (opts.bandTriple ? "photometric" : "population");
  /*
   * The depth default is PER MODE, because `depthMag` drives a different parameter in each:
   * Lupton's Q per pixel, or the per-star asinh softening. One shared default put population
   * mode's median star at a signal of 1e-4 against a 0.02 threshold — see
   * `DEFAULT_POPULATION_DEPTH_MAG`.
   *
   * THIS BINDING USED TO BE DEAD. It sat forty lines below, named and carrying this comment, while
   * the live derivation was buried inside the ternary under it — so the copy that READ as
   * authoritative was the one nothing used. Anyone changing the per-mode rule would have edited
   * the wrong one, run the build, seen it stay green (the type checker that flags an unused local
   * was not gated) and shipped no change at all.
   */
  const defaultDepthMag =
    colorMode === "photometric" ? DEFAULT_LUPTON_DEPTH_MAG : DEFAULT_POPULATION_DEPTH_MAG;
  /*
   * A stated DEPTH wins over a raw softening: it says the same thing physically.
   *
   * The fallback is the MODE's default rather than `DEFAULT_SOFTENING`, so omitting `depthMag` and
   * passing the mode's own default produce the same image. They used to differ — `DEFAULT_SOFTENING`
   * is 19.78 mag while the page sent 8 — which is why the bug was invisible in unit tests that
   * omitted the option and glaring on the page that supplied it.
   */
  const softening =
    opts.starDepthMag !== undefined
      ? softeningForLimit(fluxRatioForMagnitudes(opts.starDepthMag))
      : (opts.softening ?? softeningForLimit(fluxRatioForMagnitudes(defaultDepthMag)));
  const exposure = opts.exposure ?? 1;
  const percentile = opts.whitePercentile ?? DEFAULT_WHITE_PERCENTILE;
  const dpr = opts.pixelRatio ?? 1;
  const minMass = opts.minMass ?? 0;
  /*
   * One local, replacing five uses of the module constant. Clamped away from zero because a
   * non-positive distance divides by zero in the inverse-square law and returns an infinite flux
   * that would capture the white point.
   */
  const distancePc = Math.max(MIN_DISTANCE_PC, opts.distancePc ?? D0_PC);
  const magLimit = opts.magLimit;
  /*
   * The intensity one display level corresponds to, on the LUPTON curve — what decides how far
   * a star's billboard has to reach. Derived from the same `depthMag` the asinh path uses, so
   * one control still drives the depth, but through the transfer that is actually applied.
   */
  /*
   * ASINH IS THE DEFAULT IN BOTH MODES — Anna's call, made by looking at the three side by side
   * on the real cluster (2026-07-25), against the previous per-mode defaults of `lupton` for
   * photometric and `linear` for population.
   *
   * WHAT IT COSTS IN POPULATION MODE, recorded because it is a real property and not an oversight:
   * that mode's per-star signal has ALREADY been through `asinhResponse`, so a second asinh here
   * compresses twice. `linear` was the default precisely to avoid that. Double compression is not
   * a bug, though — it is a flatter tone curve — and which one reads better on a projector is a
   * judgement about the image rather than about the physics. The physics is unchanged either way:
   * the per-star signal, the hue and the flux ratios are identical, and only the display curve
   * differs.
   */
  const scaling = opts.scaling ?? "asinh";
  /*
   * The faintest amplitude the chosen transfer can still show, which is what decides how far a
   * star's billboard has to reach. It CANNOT be a constant: across the twelve transfers the input
   * corresponding to one display level spans 850x — 1.5e-5 for sqrt against 1.3e-2 for sinh, with
   * the photographic operators strewn between (AgX 2.0e-3, Cineon 7.2e-3) — so a fixed floor
   * would clip the faint wings under one curve into visible square edges and waste twenty times
   * the fill rate under another.
   *
   * ONE CALL, no per-family branch. `transferFloor` owns the dispatch, including the fact that
   * only Lupton's floor moves with `depthMag`; a branch here would be a second place that
   * asymmetry is written, and it is exactly the asymmetry that produced the depth bug.
   */
  /*
   * The floor follows the PIXEL depth, because it is a property of the per-pixel transfer: it is
   * the scene value that curve still renders as one display level. Feeding it the per-star depth
   * was one of the two things `depthMag` conflated.
   */
  const pixelDepthMag = opts.pixelDepthMag ?? DEFAULT_LUPTON_DEPTH_MAG;
  const displayFloor = transferFloor(scaling, pixelDepthMag);

  /*
   * THE INSTRUMENT'S OPTICS, RESOLVED ONCE AND CARRIED ON THE FIELD.
   *
   * These are used in two places that MUST agree: the quad extent solved below, and the profile
   * the shader evaluates inside that quad (`starGraph`, which used to read the module defaults
   * independently). Disagreement is not a cosmetic bug — the shader subtracts the profile's value
   * at the quad EDGE from the whole star, so a wing sized against one amplitude and shaded with
   * another dims the core and truncates the halo, silently.
   *
   * That exact bug is already recorded on `DEFAULT_AUREOLE`: `amp: 0.06` lived in `core/optics`
   * while the shader used `0.012`, which made "does the GPU match the CPU reference?" unanswerable
   * by construction. Putting the resolved values on the field is what stops a strength control
   * reintroducing it — there is now one record, and both consumers read it.
   */
  const aureoleStrength = Math.max(0, opts.aureoleStrength ?? 1);
  const spikeStrength = Math.max(0, opts.spikeStrength ?? 1);
  const aureoleParams: AureoleParams = {
    ...DEFAULT_AUREOLE,
    amp: DEFAULT_AUREOLE.amp * aureoleStrength,
  };
  /*
   * NULL, not a zero amplitude, when the spikes are off. `sizePx` already branches on whether a
   * star is in the top tier at all, so "no spider" and "a spider contributing nothing" want to be
   * the same absence rather than two paths that have to agree numerically.
   */
  const diffractionParams: DiffractionParams | null =
    spikeStrength > 0
      ? { ...DEFAULT_DIFFRACTION, amp: DEFAULT_DIFFRACTION.amp * spikeStrength }
      : null;

  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const signal = new Float32Array(count);
  const halo = new Float32Array(count);
  const sizePx = new Float32Array(count);
  const flux = new Float64Array(count);
  /*
   * Raw three-band flux, before any normalization. Kept in float64 alongside `flux` for
   * the same reason `flux` is: a band flux at 400 pc is ~1e-20 in CGS and the population
   * spans eight decades, so accumulating a percentile in float32 would lose the faint end
   * entirely.
   */
  const bandRaw = new Float64Array(count * 3);
  const intensityRaw = new Float64Array(count);
  const triple = opts.bandTriple?.map((id) => PASSBANDS[id] ?? null) ?? null;
  const haveTriple = triple !== null && triple.every((b) => b !== null);
  /*
   * PER-CHANNEL GAIN, so a reference spectrum comes out NEUTRAL.
   *
   * Without this a composite is not a colour image, it is a plot of which band sits at the
   * shortest wavelength. Raw F_lambda through the JWST triple gives an A0V-like star
   * 0.026 / 0.207 / 0.767 — a thirtyfold bias to the blue channel — because F_lambda for a
   * stellar blackbody falls steeply with wavelength, so the shortest band always wins
   * whatever the star is. Every composite came out blue, and the differences between
   * instruments were differences in how blue.
   *
   * The gain divides each channel by that band's flux for a 9550 K blackbody, which is
   * the Vega convention this package already uses for colour indices (`VEGA_TEFF_K`). An
   * A0V-like star is then grey by construction and everything else is coloured RELATIVE
   * to it — hotter bluer, cooler redder — which is both the standard astronomical
   * convention and the only one that makes a composite's hue mean something.
   *
   * Deliberately NOT a per-star normalization. `compositeColor` in core/colorimetry does
   * normalize per star, which is right there because intensity arrives separately; here
   * the triple carries intensity as well as hue, so a per-star normalization would discard
   * exactly the brightness information Lupton needs.
   */
  const channelGain: [number, number, number] = [1, 1, 1];
  if (haveTriple) {
    for (let k = 0; k < 3; k++) {
      const ref = bandIntegral((l) => planckNm(l, VEGA_TEFF_K), triple[k]!);
      channelGain[k] = ref > 0 ? 1 / ref : 0;
    }
  }

  for (let i = 0; i < count; i++) {
    const o = i * STAR_STRIDE;
    position[i * 3] = stars[o] ?? 0;
    position[i * 3 + 1] = stars[o + 1] ?? 0;
    position[i * 3 + 2] = stars[o + 2] ?? 0;

    const teff = stars[o + 4] ?? 0;
    const radius = stars[o + 5] ?? 0;

    /*
     * Each star at its OWN distance, so the inverse-square law applies within the
     * cluster and near stars really are brighter than far ones.
     *
     * The depth is the star's z in the CLUSTER's frame, not along the interactive
     * camera's axis, and that is the whole point. A cluster 400 pc away cannot be
     * orbited; the observer's line of sight is fixed at the moment of exposure.
     * Deriving depth from the live camera instead would make every star's
     * brightness change as the view rotates — the "pumping" the exposure
     * calibration exists to prevent. So orbiting turns the MODEL, not the
     * telescope, and the photometry stays put.
     *
     * Clamped away from the observer: a sampled profile has an unbounded tail, and
     * a star drawn past z = D0 would otherwise divide by a zero or negative
     * distance and return an infinite flux that captures the white point.
     */
    const dPc = Math.max(MIN_DISTANCE_PC, distancePc - (stars[o + 2] ?? 0));

    // Brightness: through a filter when one is chosen, else bolometric.
    flux[i] = band
      ? bandFlux(teff, radius, dPc, band)
      : apparentFlux(deriveLogL(teff, radius), dPc);

    /*
     * Colour is rescaled to UNIT LUMINANCE, so the display signal alone sets how
     * bright a star reads. The scheme still owns the hue; only its scale changes.
     * Left peak-normalized, a star's luminance also depended on its temperature
     * (0.90 at 5772 K against 0.48 at 45000 K), which cancelled the brightness
     * ordering — see `unitLuminanceChroma`.
     */
    const [r, g, b] = unitLuminanceChroma(scheme.color(teff));
    color[i * 3] = r;
    color[i * 3 + 1] = g;
    color[i * 3 + 2] = b;

    /*
     * Three-band flux for the Lupton path. With an instrument's triple these are real
     * band fluxes, so the hue is the physics of those filters; without one they fall back
     * to the scheme's hue times the single-band flux, which reproduces exactly what the
     * renderer shows today.
     *
     * The fallback is not a lesser version of the same thing — it is a different and
     * honest claim. A triple says "this is what those three filters recorded"; the
     * fallback says "this is a temperature ramp", and inventing a triple to make the code
     * uniform would turn the second into a false version of the first.
     */
    if (haveTriple) {
      for (let k = 0; k < 3; k++) {
        bandRaw[i * 3 + k] = bandFlux(teff, radius, dPc, triple[k]!) * channelGain[k]!;
      }
    } else {
      const f = flux[i] ?? 0;
      bandRaw[i * 3] = r * f;
      bandRaw[i * 3 + 1] = g * f;
      bandRaw[i * 3 + 2] = b * f;
    }
    intensityRaw[i] =
      ((bandRaw[i * 3] ?? 0) + (bandRaw[i * 3 + 1] ?? 0) + (bandRaw[i * 3 + 2] ?? 0)) / 3;
  }

  // Exposure is calibrated ONCE against the population and then held fixed, so
  // the image cannot pump as the camera moves.
  const whiteFlux = robustWhiteFlux(flux, percentile);
  /*
   * The Lupton channel gets its OWN white point, taken over the three-band INTENSITY
   * rather than over the single band's flux.
   *
   * It has to: Lupton's intensity is the mean of the three channels, so normalizing by a
   * percentile of one band would put display white at whatever ratio that band happens to
   * bear to the mean — a factor that changes with the instrument, silently re-exposing the
   * image every time the composite changes. Taking the percentile of the quantity the
   * transfer actually consumes makes intensity 1 mean white for every composite.
   */
  const whiteIntensity = robustWhiteFlux(intensityRaw, percentile);
  const whiteI = whiteIntensity > 0 ? whiteIntensity : 1;
  const bandFluxOut = new Float32Array(count * 3);
  if (colorMode === "photometric") {
    for (let i = 0; i < count * 3; i++) {
      bandFluxOut[i] = (exposure * (bandRaw[i] ?? 0)) / whiteI;
    }
  }
  /*
   * POPULATION MODE fills `bandFluxOut` in the second loop instead, because it needs the per-star
   * `signal`, which is not computed until then. Not an accident of ordering: the two modes differ in
   * exactly this, that one carries linear flux and the other carries an already-compressed
   * brightness times a unit-luminance hue.
   */
  const { tier } = computeTiers(flux, opts.tiers ?? DEFAULT_TIERS);

  let visible = 0;
  let clipping = 0;
  let maxSizePx = 0;
  let shown = 0;
  let absBrightest = Infinity;
  let absFaintest = -Infinity;
  let faintestVisibleMbol = -Infinity;
  let undetectedCount = 0;
  const tierCounts: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const o = i * STAR_STRIDE;
    /*
     * The mass cut zeroes a star's signal rather than removing it from the arrays.
     * Deliberate: the white point above was computed over the whole population, so
     * the surviving stars keep the exposure they had, and the cut is a comparison
     * rather than a re-normalization. It does leave a zero-signal quad in the
     * buffer, which is wasted vertex work in exchange for that property — an
     * acceptable trade in a lab, and worth compacting if this reaches production.
     */
    const cut = minMass > 0 && (stars[o + 3] ?? 0) < minMass;
    /*
     * Undetected: fainter than the instrument's limiting magnitude. Compared on the
     * star's OWN apparent magnitude at its own distance, so the near side of the
     * cluster survives a limit the far side does not — which is the real behaviour and
     * costs nothing here, since the distance is already per-star.
     *
     * Kept separate from `cut` in the counters below because the two answer different
     * questions: a mass cut is a decision about which stars to COUNT, a magnitude limit
     * is a fact about which stars the telescope can SEE. Conflating them would make the
     * lab unable to say which of the two removed a star.
     */
    const undetected =
      magLimit !== undefined &&
      band !== null &&
      abMagnitude(
        stars[o + 4] ?? 0,
        stars[o + 5] ?? 0,
        Math.max(MIN_DISTANCE_PC, distancePc - (stars[o + 2] ?? 0)),
        band,
      ) > magLimit;
    if (undetected) undetectedCount++;
    const s = cut || undetected ? 0 : asinhResponse(flux[i] ?? 0, exposure, softening, whiteFlux);
    signal[i] = s;
    if (colorMode === "population") {
      /*
       * UNIT-LUMINANCE HUE TIMES THE COMPRESSED SIGNAL.
       *
       * This is the pre-Lupton behaviour, restored deliberately rather than left behind. It is not
       * photometric and must not be described as such: `unitLuminanceChroma` has already thrown away
       * how much light the star emits, keeping only its hue, so a 0.1 Msun red dwarf arrives as
       * saturated as a 96 Msun blue giant and only `signal` distinguishes them.
       *
       * That discarding is precisely why it shows the population. Photometrically, 100 of these
       * 10,000 stars carry 92% of the light and they are all hot, so a flux-weighted hue is blue
       * everywhere — measured spread 0.021 against 0.082 here, 0.150 with the `stretched` scheme.
       * Two different claims about the same cluster; the mode names which one is being made.
       */
      bandFluxOut[i * 3] = (color[i * 3] ?? 0) * s;
      bandFluxOut[i * 3 + 1] = (color[i * 3 + 1] ?? 0) * s;
      bandFluxOut[i * 3 + 2] = (color[i * 3 + 2] ?? 0) * s;
    }
    if (s > VISIBILITY_THRESHOLD) {
      visible++;
      // Faintest star still showing, as an apparent bolometric magnitude: a larger
      // magnitude is fainter, so the deepest one is the maximum.
      const m =
        bolometricMagnitude(deriveLogL(stars[o + 4] ?? 0, stars[o + 5] ?? 0)) +
        distanceModulus(Math.max(MIN_DISTANCE_PC, distancePc - (stars[o + 2] ?? 0)));
      if (m > faintestVisibleMbol) faintestVisibleMbol = m;
    }
    if (!cut) {
      shown++;
      /*
       * Absolute magnitude of every star that is DRAWN. Computed at 10 pc, so it is
       * distance-free and describes the star rather than this view of it — a mass cut
       * changes the range because the population changed, but the depth slider and
       * the camera cannot.
       */
      const M = band
        ? absoluteAbMagnitude(stars[o + 4] ?? 0, stars[o + 5] ?? 0, band)
        : bolometricMagnitude(deriveLogL(stars[o + 4] ?? 0, stars[o + 5] ?? 0));
      if (Number.isFinite(M)) {
        if (M < absBrightest) absBrightest = M;
        if (M > absFaintest) absFaintest = M;
      }
    }
    if (s > 1) clipping++;
    /*
     * The halo drive: linear flux relative to white, uncompressed. Exposure
     * multiplies it for the same reason it multiplies the core — a longer exposure
     * collects more scattered light too.
     *
     * NOT gated by tier. The tier boundary was a percentile proxy for "bright
     * enough to show a wing", and this is the quantity it was standing in for, so
     * the halo now switches on continuously instead of stepping at a rank
     * threshold. Tiers keep their real job: the expensive optics (diffraction) that
     * genuinely should be rare.
     */
    halo[i] = (exposure * (flux[i] ?? 0)) / (whiteFlux > 0 ? whiteFlux : 1);
    /*
     * Only the BILLBOARD grows with brightness; the PSF inside it is fixed. Tier 3
     * carries diffraction, so its quad must be sized to hold the spikes.
     *
     * SIZED FROM THE LINEAR BAND FLUX, not from the compressed signal, because the
     * shader now shades `bandFlux * profileShape` and it is that amplitude which
     * decides where the profile drops below one display level. The brightest channel
     * sets the extent: a quad that held only the mean would clip whichever channel
     * dominates, and for a strongly coloured star those differ by a large factor.
     *
     * `coreExtentRadii` SOLVES for that radius where the previous `quadExtentPx`
     * interpolated `3 + 14 * s` core radii in the compressed signal — well tuned at
     * the top (17.20 solved against 17.0) but clamped above white and handing 3 radii
     * to stars that render nothing.
     */
    // Reads `bandFluxOut`, which photometric mode filled above and population mode filled a few
    // lines up — either way it is populated for star `i` before its quad is sized.
    const ampPeak = Math.max(
      bandFluxOut[i * 3] ?? 0,
      bandFluxOut[i * 3 + 1] ?? 0,
      bandFluxOut[i * 3 + 2] ?? 0,
    );
    const spikeParams = (tier[i] ?? 1) >= 3 ? (diffractionParams ?? undefined) : undefined;
    const reachRadii = Math.max(
      coreExtentRadii(ampPeak, displayFloor),
      aureoleExtentRadii(ampPeak, aureoleParams),
      spikeParams ? diffractionExtentRadii(ampPeak, spikeParams) : 0,
    );
    /*
     * TWO FLOORS, and they say different things.
     *
     * A star below the display floor reaches nowhere and gets NO quad — `reachRadii` is 0 and
     * so is its billboard. That is the honest outcome and it is new: the interpolated sizing
     * this replaced handed 3 core radii to every star, so ~13% of this population shaded a
     * 6.6 px quad to produce nothing.
     *
     * A star ABOVE the floor gets at least one PSF width even when its own reach is less.
     * Solved sizing alone put 26 of 300 stars in a quad narrower than 2.2 px, down to 0.29 px,
     * and a quad that thin is sampled wherever the pixel centre happens to fall — the aliasing
     * `MIN_RENDERABLE_PX` documents. Enlarging it is safe and slightly more accurate rather
     * than less: the profile is already below one display level out there, and the pedestal
     * subtracted at a wider edge is smaller, so the star reads marginally brighter than a
     * tight quad would have made it, not dimmer.
     */
    const px =
      reachRadii > 0
        ? Math.min(MAX_QUAD_PX, PSF_WIDTH_PX * Math.max(1, reachRadii)) * dpr
        : 0;
    sizePx[i] = px;
    if (px > maxSizePx) maxSizePx = px;
    const t = tier[i] ?? 1;
    tierCounts[t - 1] = (tierCounts[t - 1] ?? 0) + 1;
  }

  return {
    count,
    position,
    color,
    signal,
    bandFlux: bandFluxOut,
    halo,
    sizePx,
    tier,
    optics: { aureole: aureoleParams, diffraction: diffractionParams },
    stats: {
      whiteFlux,
      visible,
      clipping,
      tierCounts,
      maxSizePx,
      psfWidthPx: PSF_WIDTH_PX * dpr,
      softening,
      depthMag: magnitudeDifference(limitingFluxRatio(softening)),
      pixelDepthMag,
      faintestVisibleMbol: visible > 0 ? faintestVisibleMbol : Infinity,
      shown,
      colorMode,
      scaling,
      skyLevel: opts.skyLevel ?? 0,
      /** The distance this view was computed at [pc], so a readout never has to assume it. */
      distancePc,
      detection:
        magLimit !== undefined && band !== null
          ? {
              magLimit,
              undetected: undetectedCount,
              limitingMass: massForMagnitudeLimit(magLimit, band, distancePc),
              complete: massForMagnitudeLimit(magLimit, band, distancePc) <= MASS_SEARCH_MIN,
            }
          : null,
      absMag: {
        brightest: absBrightest,
        faintest: absFaintest,
        system: band ? "AB" : "bolometric",
      },
    },
  };
}
