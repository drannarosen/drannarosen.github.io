/*
 * scene.ts — Observed-mode renderer (the Three.js LAB HARNESS).
 *
 * All physics lives in the pure, three-free novascope CORE, filed by domain:
 * core/photometry (flux, passbands), core/colorimetry (colour schemes),
 * core/optics (PSF, aureole), core/imaging (white point, asinh stretch), with
 * viz/starfield holding the pixel-space policy and the CPU preparation. This
 * file is only the Three.js glue (ADR 0015).
 *
 * It is glue that belongs to the PACKAGE, though, not to the site — a renderer
 * is what novascope is for. So `three` is a Layer 2 dependency and the purity
 * claim is scoped to core, which is where the node gates run.
 *
 * Verified through BOTH backends: native WebGPU, and the WebGL 2 fallback via
 * `forceWebGL` — ~5% of visitors take the latter and it is a younger code path
 * than the mature WebGLRenderer, so it is exercised rather than assumed.
 */
import * as THREE from "three";
import { WebGPURenderer, RenderPipeline } from "three/webgpu";
import { pass, vec4, uniform, float } from "three/tsl";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  prepareStarField,
  STAR_STRIDE,
  MIN_DISTANCE_PC,
  type PrepareOptions,
  type StarField,
} from "./prepare.ts";
import { clusterStarTable } from "./source.ts";
import { createStarGraph, type StarGraph } from "./starGraph.ts";
import { createTransferNode, type Transfer } from "./transferNode.ts";
import { createSkyProbe, NO_SKY_MEASUREMENT, type SkyMeasurement } from "./skyProbe.ts";
import type { TransferId } from "../../core/imaging/transfers.ts";
import {
  whitePixelIntensity,
  analyticMeanIntensity,
  skyChannelWeights,
  NEUTRAL_SKY,
  type SkyWeights,
} from "./calibrate.ts";
import { transferFloor, transferDisplayGrey } from "../../core/imaging/transfers.ts";
import { DEFAULT_LUPTON_DEPTH_MAG } from "../../core/imaging/lupton.ts";
import { VISIBILITY_THRESHOLD, LEGIBILITY_LEVEL } from "../../core/imaging/index.ts";

export type RenderBackend = "webgpu" | "webgl2";

/**
 * Narrow three's base `Backend` to the WebGPU one. `WebGPUBackend` declares
 * `isWebGPUBackend: true`, but `renderer.backend` is typed as the base class, so
 * a type guard is needed — no `as` assertion asserting what the compiler cannot
 * see.
 */
function isWebGPUBackend(b: unknown): b is { isWebGPUBackend: true } {
  return typeof b === "object" && b !== null && "isWebGPUBackend" in b;
}

/**
 * The prepared field's own diagnostics, passed through unchanged.
 *
 * DERIVED from `StarField` rather than re-declared: this used to be a hand-written
 * subset (visible, clipping, tierCounts), so every new statistic had to be added
 * in two places and a consumer could only read what someone had remembered to
 * copy. Aliasing the source type means the readout cannot lag the physics.
 */
export type StarLabStats = StarField["stats"];

/**
 * How many stars actually reach the display, under the transfer that is actually applied.
 *
 * COMPUTED HERE, NOT IN `prepare`, and that is the whole point rather than a filing preference.
 * `prepare` reports `stats.visible` from `asinhResponse` — the per-star curve POPULATION mode
 * uses — and it cannot do better: the answer needs the PIXEL white point, which depends on the
 * frame size, which `prepare` does not know. So in photometric mode that number was computed
 * from a curve the renderer was not applying, and it moved the wrong way. Measured on the lab at
 * 1,500 stars going from 8 to 14 magnitudes of depth: `stats.visible` rose 11.7% -> 66.8% while
 * the count of stars standing clear of the background FELL, 786 -> 706.
 *
 * `reach` counts stars whose own peak clears `VISIBILITY_THRESHOLD` through the applied transfer
 * at the real white point. `limitedBySky` says whether the background is the binding constraint,
 * because in photometric mode it usually is — the sky there is the summed wings of every star,
 * so a star can clear the transfer floor and still be invisible against what it sits on. Saying
 * so is the difference between a readout that informs and one that promises.
 */
export interface StarReach {
  /** Stars whose peak clears the visibility threshold through the APPLIED transfer. */
  count: number;
  /**
   * Stars bright enough to actually SEE — peak above `LEGIBILITY_LEVEL` (25% of white).
   *
   * Reported beside `count` because `count`'s threshold is 2% of white, which is 5/255 and reads
   * as black. On the shipped population the two differ by a factor of a few AND they differ by
   * COLOUR: the blue stars sit at a median 75% of white, the red ones at 11%, so `count` is
   * dominated by stars a viewer cannot see and those are the red majority. That is why the frame
   * reads "all blue" while `count` claims hundreds — the number was not wrong, it was answering a
   * question nobody was asking.
   */
  legible: number;
  /**
   * The displayed level of the frame's ANALYTIC MEAN, 0-1 — an upper bound on the background,
   * not the background itself.
   *
   * Stated as a mean because that is what it is. `analyticMeanIntensity` is total light over
   * pixel count, and on a star field that distribution is heavy-tailed: measured at depth 8 it
   * reports 17% while the MEDIAN pixel is 1/255, because a handful of bright cores carry the
   * mean. It is the right quantity for calibrating an exposure — which is what it was built for
   * — and the wrong one for answering "how grey is my sky".
   *
   * A first version of this shipped a `limitedBySky` boolean derived from it. That flag came out
   * TRUE at every depth, including one where the frame was 25% pure black, which would have made
   * it the same kind of confident-and-wrong readout as the count this whole change exists to
   * fix. It was removed rather than tuned: the honest background is a low PERCENTILE of the
   * rendered pixels, which needs a readback and arrives with the sky-derivation work.
   */
  meanLevel: number;
}

export interface StarLab {
  info: { calls: number; tris: number };
  dispose(): void;
  starCount: number;
  backend: RenderBackend;
  /** Frames actually presented — the only reliable way to confirm a pause. */
  readonly frames: number;
  stats: StarLabStats;
  /** Stars reaching the display through the transfer actually applied — see `StarReach`. */
  readonly reach: StarReach;
  /** The measured background, when `skyAuto` is on. `pixels === 0` means it has not run. */
  readonly sky: SkyMeasurement;
  /**
   * Render the CURRENT scene through several transfers and return thumbnails.
   *
   * The comparison this page exists for. Flipping a dropdown and remembering is not a comparison —
   * a display transfer changes contrast and colour together, and human memory for both is poor
   * over the second it takes to re-render.
   */
  contactSheet(ids: readonly TransferId[]): Promise<ContactTile[]>;
  /** Rebuild the field with new physics options (scheme, band, exposure…). */
  update(opts: PrepareOptions): StarLabStats;
  /**
   * Move the stars without re-preparing the field — `count * 3` floats of xyz [pc].
   *
   * The per-frame path for a live integration. `update()` cannot serve one: it
   * re-runs `prepareStarField`, which costs 180-425 ms for 10,000 stars because it
   * integrates a Planck function through a filter curve per star per band.
   *
   * WHAT THIS RECOMPUTES, AND WHY IT IS EXACT RATHER THAN AN APPROXIMATION.
   * Depth feeds the image through the inverse-square law, and only as a scalar:
   * `F_lambda = pi * B_lambda(Teff) * (R/d)^2`, and `bandIntegral` is linear, so a
   * star's band flux at a new depth is its prepared flux times `(d_ref/d_now)^2`.
   * Teff and radius do not change — at this rung a star moves but does not evolve —
   * so the expensive spectral integral is a constant of the run and is reused.
   *
   * WHAT IT DELIBERATELY HOLDS FIXED.
   *   - The EXPOSURE. Calibrated once against the population, as everywhere else
   *     here, so an expanding cluster genuinely dims instead of being auto-levelled
   *     back to the same picture. Re-exposing per frame would erase the physics the
   *     caller is animating.
   *   - `sizePx` and `tier`, which derive from flux. Re-tiering per frame pops, and
   *     ADR 0015 records tiers as "a performance/appearance policy, not a size law".
   *     The flux they were assigned from moves very little: over twelve crossing
   *     times of the `/explore/dynamics` cluster, measured, the WORST star's flux
   *     changes 7.1% (0.08 mag) and the median 0.3%.
   */
  setPositions(xyz: Float32Array): void;
  /**
   * Change only what the DISPLAY does, skipping the field rebuild entirely.
   *
   * `prepareStarField` costs 180-425 ms for 10,000 stars, because it integrates a Planck function
   * through a real filter curve per star per band. Bloom, the sky level and the sky mode change
   * none of that: they are pipeline uniforms, and `prepare` carries them only so one options
   * object describes the whole image. Routing them through `update` therefore paid the entire
   * physics cost to move a slider — the difference between a control that responds and one that
   * lurches.
   *
   * Verified before relying on it: `skyLevel` and `bloom` appear in `prepare` only in its options
   * interface and in the stats it reports back. Neither reaches the star data.
   */
  setDisplay(opts: { bloom?: number; skyLevel?: number; skyAuto?: boolean }): void;
  /**
   * Whether the view is drifting. Starts false when the visitor prefers reduced
   * motion; a consumer MUST surface a visible control for it either way.
   */
  readonly drifting: boolean;
  /** Start or stop the drift. Stopping also stops redrawing (see the render tick). */
  setDrifting(on: boolean): void;
}

/** One transfer's thumbnail, as 8-bit RGBA ready for `putImageData`. */
export interface ContactTile {
  id: TransferId;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface StarLabOptions extends PrepareOptions {
  /** Force the WebGL 2 backend. Development only — exercises the fallback. */
  forceWebGL?: boolean;
  /** How many stars to sample. */
  count?: number;
  /** Cluster seed — the same seed always gives the same cluster. */
  seed?: number;
  /**
   * Supply the star table instead of sampling one — `count * STAR_STRIDE` floats
   * of `[x, y, z, mass, teff, radius]`, the layout `./source` documents.
   *
   * Exists for consumers whose stars come from somewhere this module must not
   * know about: `/explore/dynamics` integrates its cluster with `core/dynamics`
   * and hands the resulting state over each frame. Sampling internally is still
   * the default, so the lab is untouched.
   *
   * `count` and `seed` are ignored when this is given — the table already fixes
   * both, and honouring them as well would let a caller describe two different
   * populations in one options object.
   */
  stars?: Float32Array;
  /**
   * Called when a sky measurement lands, so a consumer can refresh a readout.
   *
   * The probe is ASYNC — a GPU readback resolves a frame or two after the rebuild that started
   * it — so a page rendering its status line synchronously would show "measuring…" until the next
   * unrelated control change. A callback is the smallest honest fix: without it the readout is
   * not wrong so much as permanently one step behind, which is its own kind of lie.
   */
  onSkyMeasured?: (m: SkyMeasurement) => void;
}

export async function initStarLab(
  canvas: HTMLCanvasElement,
  opts: StarLabOptions = {},
): Promise<StarLab> {
  /*
   * The population is SAMPLED, not fetched (see ./source for why the gravoturb
   * export's positions cannot be imaged). No network, and deterministic in the
   * seed, so a reload shows the identical cluster.
   *
   * A caller may supply the table instead (see `StarLabOptions.stars`); it is
   * held by reference rather than copied, because `setPositions` writes the live
   * positions back into it so a later `update()` re-prepares the cluster where it
   * actually is rather than where it started.
   */
  const stars =
    opts.stars ??
    clusterStarTable({
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      sampling: { mode: "count", target: opts.count ?? 10_000 },
    });
  const count = Math.floor(stars.length / STAR_STRIDE);
  /*
   * Frame on the cluster's own half-mass radius, measured from the stars that
   * were actually drawn rather than declared: a sampled population's r_half is a
   * property of the draw, so deriving it here means the framing cannot disagree
   * with what is on screen.
   */
  const radii: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * STAR_STRIDE;
    radii.push(Math.hypot(stars[o] ?? 0, stars[o + 1] ?? 0, stars[o + 2] ?? 0));
  }
  radii.sort((a, b) => a - b);
  const rHalfPc = radii[Math.floor(count / 2)] ?? 1;
  const framePc = rHalfPc * 6;

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    alpha: false,
    forceWebGL: opts.forceWebGL ?? false,
    // outputBufferType defaults to HalfFloatType — the linear HDR buffer this
    // pipeline needs, so it is left alone rather than restated.
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  /*
   * NO TONE MAPPING ON THE RENDERER — and now that AgX is back as a selectable transfer, this
   * line needs the reason restating, because it is no longer "we do not tone map".
   *
   * `renderer.toneMapping` is a SECOND mechanism for something the output node already does.
   * Three's operators are plain TSL functions; `renderer.toneMapping` + `renderOutput()` is a
   * wrapper that calls one of them and then applies the output colour transform. Driving the
   * choice from here as well as from `./transferNode` would mean two places decide the display
   * convention, and they would eventually disagree — with the failure showing up as a
   * double-compressed image that looks like a taste decision.
   *
   * It must also stay off for the reason bloom introduced: a pass that reads the scene must read
   * it in LINEAR HDR, and tone-mapping at the renderer happens before the pipeline's passes, so
   * it would clip the very overflow bloom keys on. Here the scene's channels are three BANDS'
   * linear flux, so there is nothing to tone map at this stage anyway.
   */
  renderer.toneMapping = THREE.NoToneMapping;
  await renderer.init();
  const backend: RenderBackend = isWebGPUBackend(renderer.backend) ? "webgpu" : "webgl2";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(0, 0, framePc);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 0.3;

  /*
   * BLOOM, and it is EARNED rather than applied.
   *
   * The threshold is 1.0 — display white — so only genuine HDR overflow blooms. That
   * is the whole point: the asinh transfer defines 1 as white and anything above it
   * as real overflow, so a star has to be bright enough to clip before it glares. On
   * this population ~50 of 10,000 stars qualify. A threshold below 1 would bloom the
   * ordinary field, which is the "more bloom instead of real optics" failure ADR 0015
   * set out to avoid — and it would double-count, because the scattered-light halo
   * and the diffraction spikes already model the physical reasons a bright star
   * spreads.
   *
   * Strength is deliberately low. Bloom here is the sensor's and eye's response to a
   * saturated source, not the optics; the optics are in `core/optics` and are
   * measured against a CPU reference. Anything strong enough to notice on a
   * non-clipping star means the threshold is wrong.
   *
   * The tone mapping and output transform move to the post-processing chain, because
   * a pass that reads the scene must read it in LINEAR HDR — tone-mapping before the
   * bloom would clip the very overflow it keys on.
   */
  const scenePass = pass(scene, camera);
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  /*
   * scene (linear band radiance) -> bloom (still linear) -> Lupton -> framebuffer.
   *
   * `renderOutput()` is deliberately NOT called on the result. It applies the output colour
   * transform, and Lupton's output is ALREADY display-referred — astropy writes
   * `make_lupton_rgb`'s result straight to a PNG for exactly this reason. Encoding it again
   * would brighten and wash the image, which is the kind of error that looks like a taste
   * decision; the GPU-versus-CPU parity check is what settles it, because the CPU reference
   * emits display values in [0, 1] and the two have to agree numerically.
   *
   * Bloom stays BEFORE the transfer and keys on 1.0 as before, which still means display white:
   * `bandFlux` is normalized so intensity 1 is the white point, so the threshold has the same
   * meaning it did under the asinh path.
   */
  /*
   * The transfer is REBUILT when the curve changes rather than selected by a uniform.
   *
   * A uniform-selected branch would keep all six curves in one shader and evaluate them all on
   * every fragment, since a GPU takes both sides of a select. Reassigning `outputNode` makes three
   * rebuild the graph — which costs a compile on a control change and nothing per frame.
   */
  /*
   * BLOOM STRENGTH IS A LIVE UNIFORM, not a literal, because it turned out to be the dominant cause
   * of a symptom I had been attributing to the display transfer.
   *
   * The threshold is display white, so only genuine overflow blooms — and in a young cluster the
   * stars that overflow are the hot blue ones. Their glow is then spread across the frame, so the
   * BACKGROUND takes their hue. Measured: with bloom the mean blue fraction is 0.75 against the CPU
   * reference's 0.15 for the same field, and the reference differs from the live pipeline in exactly
   * this one pass. Sky subtraction cannot touch it, because bloom is added AFTER the sky is removed.
   */
  const uBloom = uniform(0.35);
  const litScene = scenePass.add(bloom(scenePass, 0.35, 0.6, 1.0).mul(uBloom.div(float(0.35)))).rgb;
  /*
   * ONE FACTORY, TWELVE TRANSFERS. `createTransferNode` dispatches on the Layer 0 registry — the
   * astronomical curves build a display-referred node, the photographic ones build an operator
   * followed by the sRGB encode they are owed — so nothing here knows or cares which family is
   * selected. That is the point: the mechanism difference was the reason the control could only
   * ever offer half the options.
   */
  let transfer: Transfer = createTransferNode(litScene, "lupton");
  let transferId: TransferId = "lupton";
  const setTransfer = (id: TransferId): void => {
    if (id === transferId) return;
    transferId = id;
    transfer = createTransferNode(litScene, id);
    // Alpha is 1: the canvas is opaque (`alpha: false`) and no transfer composites. The cast is
    // the one place TSL's JSDoc-derived types fall short — see `Transfer.node`.
    pipeline.outputNode = vec4(transfer.node as never, 1);
    pipeline.needsUpdate = true;
  };
  pipeline.outputNode = vec4(transfer.node as never, 1);

  /*
   * A SECOND PIPELINE, whose output is the LINEAR scene with no transfer.
   *
   * This is what the sky probe reads. It has to be the linear stage: the sky is subtracted before
   * the transfer and after bloom, so that is the only point at which a measurement of it means
   * anything. Reading the framebuffer instead would measure a number already shaped by the very
   * curve the subtraction is meant to feed — and would also be impossible, because a WebGPU
   * drawing buffer is discarded after compositing (measured: canvas readback returns all zeros).
   *
   * It shares `litScene`, so it renders the same graph the visible pipeline does rather than a
   * second approximation of it. It runs on a rebuild, never per frame.
   */
  const probePipeline = new RenderPipeline(renderer);
  probePipeline.outputColorTransform = false;
  probePipeline.outputNode = vec4(litScene as never, 1);
  const skyProbe = createSkyProbe(renderer, probePipeline, camera);

  /*
   * Declared BEFORE `build`, because the exposure calibration reads them and `build` runs during
   * setup. They were below it at first and the whole scene died with "Cannot access 'bufW'
   * before initialization" — a temporal-dead-zone error, so the renderer never started at all.
   */
  let bufW = 0;
  let bufH = 0;
  let graph: StarGraph | null = null;
  /*
   * Seeded by an actual preparation of an empty field rather than a hand-written
   * zero literal, so this initializer cannot drift as `StarField["stats"]` gains
   * members — which is the same reason `StarLabStats` aliases that type.
   */
  let stats: StarLabStats = prepareStarField(new Float32Array(0)).stats;

  let lastField: StarField | null = null;
  /** Per-star band flux and depth as prepared — the reference `setPositions` rescales from. */
  let bandFlux0: Float32Array = new Float32Array(0);
  let depth0: Float32Array = new Float32Array(0);
  let reach: StarReach = { count: 0, legible: 0, meanLevel: 0 };
  /*
   * The PIXEL depth — Lupton's Q and the display floor. Named for what it drives now that
   * `depthMag`'s two meanings have been separated; the per-star depth never reaches this file,
   * because it is consumed inside `prepare` where the star signal is computed.
   */
  let lastDepthMag = DEFAULT_LUPTON_DEPTH_MAG;
  /* The background's colour, unit-mean. Re-derived on every recalibration; see `recalibrate`. */
  let skyWeights: SkyWeights = NEUTRAL_SKY;
  let lastSkyLevel = 0;
  let skyAuto = false;
  let sky: SkyMeasurement = NO_SKY_MEASUREMENT;
  /*
   * Rebuilds race the probe: it is async, and a slider drag can start three before the first
   * resolves. A token means only the newest result is ever applied — without it a stale
   * measurement lands after a newer one and the sky flickers backwards, which reads as an
   * unstable renderer rather than as a stale promise.
   */
  let probeToken = 0;

  /*
   * CALIBRATE THE DISPLAY TRANSFER for the current field at the current frame size.
   *
   * The white point is a property of the rendered PIXELS, not of the stars — a background pixel
   * sums thousands of wings and lands three orders of magnitude above a median star's own peak —
   * so it cannot be read off the per-star normalization. `whitePixelIntensity` derives it
   * analytically in well under a millisecond (see ./calibrate), which is why this can run on
   * every change rather than needing a GPU histogram pass.
   *
   * CALLED ON RESIZE AS WELL AS ON REBUILD, and that is not incidental. The mean pixel intensity
   * is total light over PIXEL COUNT, so it goes as 1/area: doubling both dimensions quarters it,
   * which check:calibrate asserts exactly. Calibrating only at build would leave every resized
   * frame exposed for the size it used to be — four times too bright on a shrink.
   *
   * NOT called per frame, though. It depends on the population and the frame size, neither of
   * which an orbit changes, and recalibrating per frame would make the exposure pump as the
   * camera moved — the failure the original per-population white point was introduced to prevent.
   */
  const recalibrate = (): void => {
    if (!lastField) return;
    /*
     * DEVICE PIXELS, NOT CSS PIXELS — and the difference was a factor of dpr^2 in the exposure.
     *
     * `bufW`/`bufH` are `canvas.clientWidth/Height`, i.e. CSS px, because that is what
     * `renderer.setSize(w, h, false)` takes. Three then multiplies by the pixel ratio to size the
     * drawing buffer, so the grid actually rendered is `bufW * dpr` by `bufH * dpr`.
     *
     * `analyticMeanIntensity` divides total light by a PIXEL COUNT, and the light it sums is
     * `profileIntegral(...) * psf^2` where `psf = field.stats.psfWidthPx` is in DEVICE px. Feeding
     * it the CSS count therefore divided device-pixel light by a CSS-pixel area and returned a mean
     * — and so a white point — exactly dpr^2 too high.
     *
     * Measured on a dpr-2 display at 780x487 CSS: white point 9.408e-1 against the correct
     * 2.352e-1, exactly 4.00x. The consequence was not subtle and it was not uniform: 637 stars
     * cleared the display floor instead of 985, and the RED ones fell 553 -> 247, because a
     * too-bright white point crushes the faint end and the faint stars are the red ones. Anna
     * reported the frame as "all I see is blue", which is what a 4x over-exposure of this
     * population looks like. It affected every HiDPI screen and no 1x screen, which is why nothing
     * in the fixtures caught it — those are internally consistent about their own grid.
     */
    const dpr = renderer.getPixelRatio();
    const w = (bufW || canvas.clientWidth) * dpr;
    const h = (bufH || canvas.clientHeight) * dpr;
    if (!(w > 0) || !(h > 0)) return; // before layout; guessing a size mis-exposes the frame
    /*
     * The white point comes from the SAME analytic mean either way, but what it means differs: for
     * Lupton it is the intensity mapped to display white, for a scalar curve it is the divisor
     * applied before the curve. Both are "the radiance that should read as white", which is why one
     * calibration serves both.
     */
    /*
     * THE WHITE POINT MEANS DIFFERENT THINGS BY MODE, so it is derived differently.
     *
     * Photometric carries LINEAR flux, whose pixel sums bear no fixed relation to any per-star
     * quantity — a background pixel lands three orders of magnitude above a median star's own peak —
     * so it needs the analytic estimate.
     *
     * Population carries an already-normalised per-star signal, where 1 IS the white point by
     * construction (the 99.5th-percentile star maps there). Its overlaps clip to white, which is what
     * the pre-Lupton path did too. Feeding it the photometric estimate applied a calibration for a
     * different quantity — measured as a 1.43 mag spread against 0.41 where it belongs.
     */
    /*
     * THE FLOOR MUST BE THE SELECTED TRANSFER'S, not Lupton's.
     *
     * `floor` sets how far each star's quad is integrated, and `prepare` sizes the billboards
     * actually drawn from the same number — so passing Lupton's floor while drawing AgX-sized
     * quads estimates the mean of an image that is not on screen. It was already inconsistent
     * for the five astropy curves; making the transfer selectable put it on the one comparison
     * this page exists for.
     *
     * IT COSTS ALMOST NO EXPOSURE, which is the part worth having measured rather than argued.
     * The twelve floors span 850x, and the white point moves 0.0080 mag across all of them
     * (1.45%) — because the Moffat core and the aureole both have CONVERGENT area integrals, so
     * a wider quad adds area and almost no energy. The calibration constant's own spread across
     * seventeen configurations is 0.41 mag, fifty times larger. So switching transfer changes the
     * curve and not the exposure, and an A/B stays a comparison of curves. Gated in
     * `check:transfers`, because that is a claim that could quietly stop being true.
     */
    const white =
      lastField.stats.colorMode === "photometric"
        ? whitePixelIntensity(lastField, w, h, {
            floor: transferFloor(lastField.stats.scaling, lastDepthMag),
          })
        : 1;
    transfer.setDepth(lastDepthMag, white);
    /*
     * A MEASURED sky overrides the manual one when auto is on. `setSky` takes a FRACTION of the
     * white point and the probe returns an absolute radiance, so it is divided here — one
     * conversion, at the boundary, rather than a probe that has to know about exposure.
     */
    const skyFraction = skyAuto && sky.pixels > 0 ? sky.level / white : lastSkyLevel;
    /*
     * THE BACKGROUND'S COLOUR, derived per frame alongside its level.
     *
     * Computed here rather than in `prepare` because it depends on the FRAME SIZE — a star's
     * contribution is its flux over the pixel count, and the quad extents that weight it are in
     * pixels. It is the same integral `measureReach` below already runs, so this is one extra
     * traversal per recalibration, not a new model of the sky.
     */
    skyWeights = skyChannelWeights(lastField, w, h, {
      floor: transferFloor(lastField.stats.scaling, lastDepthMag),
    });
    transfer.setSky(skyFraction, white, skyWeights);
    reach = measureReach(lastField, white, w, h, skyFraction);
  };

  /*
   * Count what the APPLIED transfer actually puts on screen, at the real white point.
   *
   * A star's own peak contribution to a pixel is its `bandFlux` (the profile peaks at 1 at the
   * centre), and `whitePixelIntensity` is in those same units — so both go through
   * `transferDisplayGrey` unchanged. The sky is estimated from `analyticMeanIntensity`, which is
   * the same quantity the exposure calibration already trusts, so no second model of the
   * background is introduced here.
   *
   * The threshold is `VISIBILITY_THRESHOLD`, unchanged, so this is the SAME criterion the old
   * count used — only the curve it is applied to is different, which is precisely the bug.
   */
  function measureReach(
    field: StarField,
    white: number,
    w: number,
    h: number,
    skyFraction: number,
  ): StarReach {
    const id = field.stats.scaling;
    /*
     * THE BACKGROUND IS MEASURED, NOT READ OFF THE SUBTRACTION CONTROL.
     *
     * A first version used `lastSkyLevel` here — the amount the user has chosen to SUBTRACT — and
     * so reported a background of zero whenever nothing had been subtracted, which is exactly
     * when the sky is the problem. That is the same shape of lie as the count this function
     * exists to fix: a number that reads plausibly and is measuring the wrong thing.
     *
     * `analyticMeanIntensity` is the real estimate. It is total light over pixel count, so on a
     * star field it IS the diffuse background — the summed wings of every star — and it is the
     * same quantity the exposure calibration already trusts, so no second model of the sky is
     * introduced. The subtraction is then removed from it, because that is what the transfer sees.
     */
    const mean = analyticMeanIntensity(field, w, h, { floor: transferFloor(id, lastDepthMag) });
    const meanLevel = transferDisplayGrey(
      id,
      Math.max(0, mean - lastSkyLevel * white),
      white,
      lastDepthMag,
    );
    /*
     * THE SUBTRACTION IS APPLIED TO EACH STAR, and leaving it out was a lie measured at 13x.
     *
     * The line above already removes the sky from the frame MEAN. This loop did not remove it from
     * the stars, so it answered "how many would clear the floor if nothing were subtracted" while
     * reporting itself as what the display shows. At a 6.43%-of-white subtraction the readout said
     * 10,000 of 10,000 reached the display (100.0%) against 779 that actually survived — and that
     * number is what a person judges every other change by.
     *
     * The THIRD instance of this shape in this one function, which is why it is spelled out: a
     * count taken on the wrong curve, a background read off the subtraction control instead of
     * being measured, and now a threshold applied before the subtraction. Each read plausibly.
     *
     * PER CHANNEL, because the sky is per channel now — a star survives if any channel does, so
     * the max is taken AFTER subtracting each channel's own level, not before.
     */
    const level = Math.max(0, skyFraction) * white;
    let count = 0;
    let legible = 0;
    for (let i = 0; i < field.count; i++) {
      const peak = Math.max(
        (field.bandFlux[i * 3] ?? 0) - level * (skyWeights[0] ?? 1),
        (field.bandFlux[i * 3 + 1] ?? 0) - level * (skyWeights[1] ?? 1),
        (field.bandFlux[i * 3 + 2] ?? 0) - level * (skyWeights[2] ?? 1),
      );
      if (peak <= 0) continue;
      /* ONE transfer evaluation, two thresholds — see `LEGIBILITY_LEVEL` for why both are
       * reported. Computing them in one pass keeps them describing the same star set. */
      const display = transferDisplayGrey(id, peak, white, lastDepthMag);
      if (display > VISIBILITY_THRESHOLD) count++;
      if (display > LEGIBILITY_LEVEL) legible++;
    }
    return { count, legible, meanLevel };
  }

  /*
   * Measure the sky, then re-apply the calibration with it.
   *
   * Fire-and-forget on purpose: the frame that is already on screen is correct for the manual
   * sky, and the measured one arrives a frame or two later. Blocking the rebuild on a GPU
   * readback would add its latency to every slider tick, and the rebuild is already the
   * expensive part.
   */
  const probeSky = (): void => {
    if (!skyAuto) return;
    const token = ++probeToken;
    const w = bufW || canvas.clientWidth;
    const h = bufH || canvas.clientHeight;
    void skyProbe
      .measure(w, h)
      .then((m) => {
        if (token !== probeToken) return; // a newer rebuild has already superseded this
        sky = m;
        recalibrate();
        dirty = true;
        opts.onSkyMeasured?.(m);
      })
      .catch(() => {
        /* A lost device or a resize mid-readback. Keep the manual sky rather than a bad one. */
      });
  };

  /*
   * CONTACT SHEET — the same scene through several transfers, side by side.
   *
   * Everything is held fixed except the transfer: same field, same camera, same white point, same
   * sky, same bloom. That is the whole value — a difference between two tiles is a difference
   * between two curves and nothing else.
   *
   * RENDERED SMALLER THAN THE CANVAS, and the caveat is worth stating rather than hiding. The
   * background level depends on resolution, because the PSF width is fixed in PIXELS: at a smaller
   * size each star's wings cover more of the frame and overlap more (measured elsewhere as a 1.57x
   * drift in median/mean from 96x60 to 320x200). So a tile is NOT identical to the full frame
   * under the same transfer. It does not need to be: every tile is rendered at the same size, so
   * the comparison BETWEEN them is exact even though each differs from the full-size render.
   *
   * 256 wide because a WebGPU readback needs `bytesPerRow` to be a multiple of 256, and at RGBA
   * float that is 16 bytes per pixel — 256 x 16 = 4096 exactly. A width of 300 fails with a large
   * spatial error and the correct total energy, which reads as a renderer bug and is a harness one.
   */
  const TILE_W = 256;
  const TILE_H = 160;
  const sheetTarget = new THREE.RenderTarget(TILE_W, TILE_H, {
    type: THREE.FloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  async function renderContactSheet(ids: readonly TransferId[]): Promise<ContactTile[]> {
    if (!lastField) return [];
    /*
     * DEVICE PIXELS here too — same dpr^2 error as `recalibrate`, and it had to be fixed in both or
     * the sheet would be exposed differently from the canvas it is meant to be compared against.
     * `TILE_W`/`TILE_H` are already device px (they size a render target), so only the canvas
     * fallback needs scaling.
     */
    const sheetDpr = renderer.getPixelRatio();
    const white =
      lastField.stats.colorMode === "photometric"
        ? whitePixelIntensity(lastField, (bufW || TILE_W) * sheetDpr, (bufH || TILE_H) * sheetDpr, {
            floor: transferFloor(lastField.stats.scaling, lastDepthMag),
          })
        : 1;
    const restore = transferId;
    const tiles: ContactTile[] = [];
    try {
      for (const id of ids) {
        const t = createTransferNode(litScene, id);
        t.setDepth(lastDepthMag, white);
        t.setSky(skyAuto && sky.pixels > 0 ? sky.level / white : lastSkyLevel, white, skyWeights);
        pipeline.outputNode = vec4(t.node as never, 1);
        pipeline.needsUpdate = true;
        renderer.setRenderTarget(sheetTarget);
        await pipeline.renderAsync();
        const px = (await renderer.readRenderTargetPixelsAsync(
          sheetTarget,
          0,
          0,
          TILE_W,
          TILE_H,
        )) as Float32Array;
        renderer.setRenderTarget(null);
        /*
         * The values are already DISPLAY-REFERRED — astronomical transfers by convention,
         * photographic ones because `transferNode` applies the sRGB encode. So this is a scale to
         * 8 bits and nothing more; another encode here would be the double-encode this pipeline
         * is built to avoid.
         *
         * FLIPPED VERTICALLY: `readRenderTargetPixelsAsync` is top-down on WebGPU, and a tile
         * drawn upside down is the recorded failure that looks like a physics bug.
         */
        const out = new Uint8ClampedArray(TILE_W * TILE_H * 4);
        for (let y = 0; y < TILE_H; y++) {
          const src = (TILE_H - 1 - y) * TILE_W * 4;
          const dst = y * TILE_W * 4;
          for (let x = 0; x < TILE_W * 4; x += 4) {
            out[dst + x] = (px[src + x] ?? 0) * 255;
            out[dst + x + 1] = (px[src + x + 1] ?? 0) * 255;
            out[dst + x + 2] = (px[src + x + 2] ?? 0) * 255;
            out[dst + x + 3] = 255;
          }
        }
        tiles.push({ id, width: TILE_W, height: TILE_H, pixels: out });
      }
    } finally {
      // Put the visible pipeline back exactly as it was, whatever happened above.
      renderer.setRenderTarget(null);
      transferId = restore;
      transfer = createTransferNode(litScene, restore);
      pipeline.outputNode = vec4(transfer.node as never, 1);
      pipeline.needsUpdate = true;
      recalibrate();
      dirty = true;
    }
    return tiles;
  }

  const build = (o: PrepareOptions): StarLabStats => {
    if (graph) {
      scene.remove(graph.mesh);
      graph.dispose();
    }
    // Core sizes are authored in CSS px; the GPU works in device px.
    const field = prepareStarField(stars, { pixelRatio: renderer.getPixelRatio(), ...o });
    graph = createStarGraph(field);
    scene.add(graph.mesh);
    lastField = field;
    /*
     * The reference state `setPositions` rescales FROM. Snapshotted at prepare
     * time rather than recomputed, because the rescale must divide out exactly
     * the depth this field's fluxes were computed at — deriving it later from
     * the live positions would divide out the CURRENT depth and hold the image
     * frozen instead of updating it.
     */
    bandFlux0 = field.bandFlux.slice();
    depth0 = new Float32Array(field.count);
    for (let i = 0; i < field.count; i++) depth0[i] = field.position[i * 3 + 2] ?? 0;
    lastDepthMag = o.pixelDepthMag ?? DEFAULT_LUPTON_DEPTH_MAG;
    lastSkyLevel = o.skyLevel ?? 0;
    skyAuto = o.skyAuto ?? false;
    if (!skyAuto) sky = NO_SKY_MEASUREMENT;
    uBloom.value = o.bloom ?? 0.35;
    // The field RESOLVED which transfer it expects (the default depends on the colour mode), so the
    // pipeline follows the field rather than the caller — they cannot disagree.
    setTransfer(field.stats.scaling);
    recalibrate();
    probeSky();
    stats = field.stats;
    return stats;
  };
  build(opts);

  /*
   * Reconcile the drawing buffer with the canvas's layout box inside the render
   * tick, plus once at init and on the next macrotask.
   *
   * ResizeObserver looks like the right answer and is not: its callbacks are
   * delivered BEFORE PAINT, so in a non-painting context it never fires at all —
   * measured firing zero times while the canvas genuinely resized 1342 -> 1131
   * CSS px. rAF is paint-dependent too, so a purely per-frame reconciliation
   * leaves the buffer at the renderer's default there. Star sizes are specified
   * in PIXELS, so a stale buffer mis-sizes every star.
   */
  const syncSize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return; // before layout; guessing a size mis-sizes stars
    if (w === bufW && h === bufH) return;
    bufW = w;
    bufH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    recalibrate(); // the white point goes as 1/area, so a resize re-exposes the frame
    dirty = true; // a resized buffer must be redrawn even while paused
  };

  /*
   * MOTION AND REDRAW ARE SEPARATE THINGS, and conflating them is why a paused
   * canvas usually still burns a GPU at 60 fps.
   *
   * `dirty` marks "the image would differ from what is on screen". Drift sets it
   * every frame; a drag, a resize, or a rebuild set it once. So pausing genuinely
   * stops the work instead of merely freezing the camera, while a paused viewer can
   * still orbit by hand and see the result.
   *
   * `prefers-reduced-motion` decides the STARTING state, and the visible control can
   * override it in either direction — someone who reduces motion system-wide may
   * still want to watch this, and someone who has not may still want it to stop.
   */
  let dirty = true;
  let drifting = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotate = drifting;
  controls.addEventListener("change", () => {
    dirty = true;
  });

  syncSize();
  const settle = setTimeout(syncSize, 0);

  let raf = 0;
  /*
   * Frames actually PRESENTED. Exposed because "is it paused?" cannot be answered
   * from the canvas: a WebGPU drawing buffer is discarded after compositing, so
   * reading pixels on a frame that was never drawn returns stale or blank data and
   * looks exactly like motion. This counter is the ground truth, and it is what the
   * pause control is verified against.
   */
  let frames = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    syncSize();
    controls.update();
    if (drifting) dirty = true;
    if (!dirty) return;
    dirty = false;
    frames++;
    /*
     * Through the PIPELINE, not renderer.render — otherwise the bloom pass is built
     * and never used, which looks exactly like a bloom that does nothing.
     *
     * Synchronous `render()`, not `renderAsync()`: three deprecated the latter and
     * warns that the correct pattern is `await renderer.init()` at construction
     * followed by a sync render, which is what this does.
     */
    pipeline.render();
  };
  raf = requestAnimationFrame(tick);

  return {
    /** Draw-call diagnostics — ground truth for "is anything rendering". */
    get info() {
      return { calls: renderer.info.render.drawCalls, tris: renderer.info.render.triangles };
    },
    starCount: count,
    backend,
    get frames() {
      return frames;
    },
    get stats() {
      return stats;
    },
    get reach() {
      return reach;
    },
    get sky() {
      return sky;
    },
    contactSheet: renderContactSheet,
    update(next) {
      const s = build(next);
      dirty = true; // a rebuilt field must reach the screen even while paused
      return s;
    },
    setPositions(xyz) {
      const field = lastField;
      if (!field || !graph) return;
      const n = Math.min(field.count, Math.floor(xyz.length / 3));
      const dCentre = field.stats.distancePc;
      const pos = field.position;
      const bf = field.bandFlux;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        const x = xyz[o] ?? 0;
        const y = xyz[o + 1] ?? 0;
        const z = xyz[o + 2] ?? 0;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        /* Keep the SOURCE table in step too, so a later `update()` re-prepares the
           cluster where it now is rather than where it was born. */
        const so = i * STAR_STRIDE;
        stars[so] = x;
        stars[so + 1] = y;
        stars[so + 2] = z;
        /* Same clamp as `prepare` (imported, not restated) — see MIN_DISTANCE_PC. */
        const dRef = Math.max(MIN_DISTANCE_PC, dCentre - (depth0[i] ?? 0));
        const dNow = Math.max(MIN_DISTANCE_PC, dCentre - z);
        const k = (dRef / dNow) ** 2;
        bf[o] = (bandFlux0[o] ?? 0) * k;
        bf[o + 1] = (bandFlux0[o + 1] ?? 0) * k;
        bf[o + 2] = (bandFlux0[o + 2] ?? 0) * k;
      }
      /* The StarField arrays ARE the InstancedBufferAttribute arrays (starGraph
         hands the same objects to both), so writing above is the upload — it just
         has to be flagged. */
      const geo = graph.mesh.geometry;
      geo.getAttribute("iPos").needsUpdate = true;
      geo.getAttribute("iBandFlux").needsUpdate = true;
      dirty = true;
    },
    setDisplay(next) {
      if (next.bloom !== undefined) uBloom.value = next.bloom;
      if (next.skyLevel !== undefined) lastSkyLevel = next.skyLevel;
      if (next.skyAuto !== undefined && next.skyAuto !== skyAuto) {
        skyAuto = next.skyAuto;
        // Turning auto OFF must drop the measurement, or the manual slider would be ignored while
        // appearing to be in charge.
        if (!skyAuto) sky = NO_SKY_MEASUREMENT;
      }
      recalibrate();
      probeSky();
      dirty = true;
    },
    get drifting() {
      return drifting;
    },
    setDrifting(on: boolean) {
      drifting = on;
      controls.autoRotate = on;
      // Redraw once on the way to a stop, so the final frame is the settled one.
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      controls.dispose();
      if (graph) {
        scene.remove(graph.mesh);
        graph.dispose();
      }
      skyProbe.dispose();
      sheetTarget.dispose();
      void renderer.dispose();
    },
  };
}
