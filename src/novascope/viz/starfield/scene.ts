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
import { prepareStarField, STAR_STRIDE, type PrepareOptions, type StarField } from "./prepare.ts";
import { clusterStarTable } from "./source.ts";
import { createStarGraph, type StarGraph } from "./starGraph.ts";
import { createTransferNode, type Transfer } from "./transferNode.ts";
import type { TransferId } from "../../core/imaging/transfers.ts";
import { whitePixelIntensity } from "./calibrate.ts";
import { transferFloor } from "../../core/imaging/transfers.ts";
import { DEFAULT_LUPTON_DEPTH_MAG } from "../../core/imaging/lupton.ts";

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

export interface StarLab {
  info: { calls: number; tris: number };
  dispose(): void;
  starCount: number;
  backend: RenderBackend;
  /** Frames actually presented — the only reliable way to confirm a pause. */
  readonly frames: number;
  stats: StarLabStats;
  /** Rebuild the field with new physics options (scheme, band, exposure…). */
  update(opts: PrepareOptions): StarLabStats;
  /**
   * Whether the view is drifting. Starts false when the visitor prefers reduced
   * motion; a consumer MUST surface a visible control for it either way.
   */
  readonly drifting: boolean;
  /** Start or stop the drift. Stopping also stops redrawing (see the render tick). */
  setDrifting(on: boolean): void;
}

export interface StarLabOptions extends PrepareOptions {
  /** Force the WebGL 2 backend. Development only — exercises the fallback. */
  forceWebGL?: boolean;
  /** How many stars to sample. */
  count?: number;
  /** Cluster seed — the same seed always gives the same cluster. */
  seed?: number;
}

export async function initStarLab(
  canvas: HTMLCanvasElement,
  opts: StarLabOptions = {},
): Promise<StarLab> {
  /*
   * The population is SAMPLED, not fetched (see ./source for why the gravoturb
   * export's positions cannot be imaged). No network, and deterministic in the
   * seed, so a reload shows the identical cluster.
   */
  const stars = clusterStarTable({
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
  let lastDepthMag = DEFAULT_LUPTON_DEPTH_MAG;
  let lastSkyLevel = 0;

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
    const w = bufW || canvas.clientWidth;
    const h = bufH || canvas.clientHeight;
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
    transfer.setSky(lastSkyLevel, white);
  };

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
    lastDepthMag = o.depthMag ?? DEFAULT_LUPTON_DEPTH_MAG;
    lastSkyLevel = o.skyLevel ?? 0;
    uBloom.value = o.bloom ?? 0.35;
    // The field RESOLVED which transfer it expects (the default depends on the colour mode), so the
    // pipeline follows the field rather than the caller — they cannot disagree.
    setTransfer(field.stats.scaling);
    recalibrate();
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
    update(next) {
      const s = build(next);
      dirty = true; // a rebuilt field must reach the screen even while paused
      return s;
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
      void renderer.dispose();
    },
  };
}
