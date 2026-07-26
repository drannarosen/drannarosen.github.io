/*
 * viz/webgl's node-reachable logic.
 *
 * ── WHY THIS EXISTS ──
 *
 * `viz/webgl` is ~800 lines behind three shipped /explore pages (cluster, gas-expulsion,
 * mass-segregation) plus volume-lab and cluster-lab, and until now it had NO coverage of any kind.
 * The 2026-07-26 audit named it as the largest ungated subsystem in the package.
 *
 * Most of it needs a GPU and belongs in a browser harness. What does NOT is tested here: the star
 * sizing law, the colorbar floor anchoring, and the no-WebGL2 degradation path. `engine.ts`
 * imports no `three` and touches the DOM only inside functions, so it loads in node — which is
 * what makes this possible at all, and is worth preserving.
 */
import { describe, expect, it } from "vitest";
import { buildStarBuffer, createEngine, DEFAULT_ZOOM, ZOOM_MIN, ZOOM_MAX } from "./engine.ts";
import { sceneFromParts, type Scene } from "./scene.ts";
import { T_SUN_K } from "../../core/constants/index.ts";

/** One star's row in the export layout: x, y, z, mass, teff, radius. */
const star = (teff: number, radius: number, xyz: [number, number, number] = [0, 0, 0]) =>
  [xyz[0], xyz[1], xyz[2], 1, teff, radius];

const STRIDE_OUT = 7; // [x,y,z, r,g,b, size]
const sizeOf = (buf: Float32Array, i: number) => buf[i * STRIDE_OUT + 6]!;

describe("star sizing runs on the magnitude scale", () => {
  /*
   * The law, from engine.ts: logL = 2*log10(R) + 4*log10(T/Tsun), mapped linearly over a FIXED
   * window [-3.5, 6.5] dex to a marker size in [1, 4].
   *
   * Fixed, not per-population, and that is the property worth pinning: it means a 20 Msun star is
   * the same size in every realization, so two figures can be compared. A window derived from the
   * draw would silently rescale every star when the sample changed.
   */
  it("is monotone in luminosity, not in radius", () => {
    /* A large cool star and a small hot one: radius says the opposite of luminosity, and
     * luminosity must win. R^2 T^4 — the 4th power on temperature dominates. */
    const cool = star(3000, 5); // logL = 2*log10(5) + 4*log10(3000/T_sun)
    const hot = star(30000, 1);
    const buf = buildStarBuffer(new Float32Array([...cool, ...hot]));
    expect(sizeOf(buf, 1)).toBeGreaterThan(sizeOf(buf, 0));
  });

  it("gives equal magnitude steps equal size steps", () => {
    /*
     * Linear in log L is the whole point — a magnitude scale. Three stars a fixed dex apart in
     * luminosity must be equally spaced in size.
     *
     * The radii here stay inside [0.05, 30] deliberately. The first version of this test used
     * logL = 0, 2, 4, which needs R = 1, 10, 100 — and the third is CLAMPED (see the next case),
     * so its luminosity came out 2.95 dex rather than 4 and the spacing was correctly unequal.
     * The law was fine; the test had walked outside its domain.
     */
    const at = (logL: number) => star(T_SUN_K, 10 ** (logL / 2)); // T = Tsun => logL = 2 log10 R
    const buf = buildStarBuffer(new Float32Array([...at(0), ...at(1), ...at(2)]));
    const d1 = sizeOf(buf, 1) - sizeOf(buf, 0);
    const d2 = sizeOf(buf, 2) - sizeOf(buf, 1);
    expect(d2).toBeCloseTo(d1, 6);
  });

  it("clamps RADIUS to [0.05, 30] before deriving luminosity", () => {
    /*
     * Found by writing the test above. The clamp is on R, not on the final size, so two stars
     * differing only above 30 Rsun render identically — their luminosities were made equal before
     * the sizing law ever saw them.
     *
     * That is defensible for ZAMS data (Tout tops out near 20 Rsun at 100 Msun) and it is a real
     * ceiling worth stating: an evolved-star dataset with supergiants would hit it, and they would
     * all come out the same size with nothing reporting why.
     */
    const a = buildStarBuffer(new Float32Array([...star(T_SUN_K, 30)]));
    const b = buildStarBuffer(new Float32Array([...star(T_SUN_K, 300)]));
    expect(sizeOf(b, 0)).toBe(sizeOf(a, 0));

    const tiny = buildStarBuffer(new Float32Array([...star(T_SUN_K, 0.05)]));
    const tinier = buildStarBuffer(new Float32Array([...star(T_SUN_K, 0.0001)]));
    expect(sizeOf(tinier, 0)).toBe(sizeOf(tiny, 0));
  });

  it("does not depend on the rest of the population", () => {
    /* The same star, drawn alone and drawn beside a far brighter one, must come out the same
     * size. This is what a per-draw normalisation would break. */
    const target = star(T_SUN_K, 1);
    const alone = buildStarBuffer(new Float32Array([...target]));
    const crowded = buildStarBuffer(new Float32Array([...target, ...star(45000, 20)]));
    expect(sizeOf(crowded, 0)).toBe(sizeOf(alone, 0));
  });

  it("clamps rather than letting an out-of-range star escape the size window", () => {
    const tiny = buildStarBuffer(new Float32Array([...star(1500, 0.001)]));
    const huge = buildStarBuffer(new Float32Array([...star(60000, 500)]));
    expect(sizeOf(tiny, 0)).toBeGreaterThanOrEqual(1);
    expect(sizeOf(huge, 0)).toBeLessThanOrEqual(4);
  });

  it("emphasizeHot is a DISPLAY nudge and touches only the hottest stars", () => {
    /* Named in engine.ts as "not physics". Asserting the scope keeps it honest: a solar star must
     * be untouched, so the option cannot quietly become a global size change. */
    const rows = new Float32Array([...star(T_SUN_K, 1), ...star(35000, 10)]);
    const plain = buildStarBuffer(rows, false);
    const nudged = buildStarBuffer(rows, true);
    expect(sizeOf(nudged, 0)).toBe(sizeOf(plain, 0));
    expect(sizeOf(nudged, 1)).toBeGreaterThan(sizeOf(plain, 1));
  });

  it("carries positions through untouched", () => {
    const buf = buildStarBuffer(new Float32Array([...star(T_SUN_K, 1, [1.5, -2.5, 0.25])]));
    expect([buf[0], buf[1], buf[2]]).toEqual([1.5, -2.5, 0.25]);
  });
});

describe("the log colorbar anchors on the MEDIAN density", () => {
  /*
   * From scene.ts: "the volume-weighted MEAN sits ~1 dex above the median for a lognormal field,
   * so a mean floor shows only the dense core; anchor the default at the MEDIAN so the filamentary
   * cloud beyond it shows."
   *
   * That is a scientific presentation choice with a visible consequence, and the default silently
   * flipping to the mean would hide the filaments the gas figures exist to show.
   */
  const meta = {
    volume_log_min: 0,
    volume_log_max: 4,
    volume_log_median: 1,
    volume_log_mean: 2,
    volume_ngrid: 4,
    box_pc: 6,
  };
  const parts = () => sceneFromParts(meta, new Uint8Array(64), new Float32Array(6));

  it("defaults the floor to the median, not the mean", () => {
    const s = parts();
    expect(s.densityFloor).toBe(s.floorMedian);
    expect(s.densityFloor).not.toBe(s.floorMean);
  });

  it("normalises both anchors into the texture's 0..1 log range", () => {
    const s = parts();
    expect(s.floorMedian).toBeCloseTo((1 - 0) / (4 - 0), 12);
    expect(s.floorMean).toBeCloseTo((2 - 0) / (4 - 0), 12);
    expect(s.logRange).toBe(4);
  });

  it("falls back to the mean when no median is exported, and to the minimum when neither is", () => {
    /* Older exports predate volume_log_median. The fallback chain must not divide by zero or
     * produce a floor outside [0,1], either of which renders an empty or fully-saturated cube. */
    const noMedian = sceneFromParts({ ...meta, volume_log_median: undefined as unknown as number }, new Uint8Array(64), new Float32Array(6));
    expect(noMedian.floorMedian).toBeCloseTo(0.5, 12);
    const neither = sceneFromParts(
      { ...meta, volume_log_median: undefined as unknown as number, volume_log_mean: undefined as unknown as number },
      new Uint8Array(64),
      new Float32Array(6),
    );
    expect(neither.floorMedian).toBe(0);
  });

  it("survives a degenerate log range instead of dividing by zero", () => {
    const flat = sceneFromParts({ ...meta, volume_log_min: 3, volume_log_max: 3 }, new Uint8Array(64), new Float32Array(6));
    expect(Number.isFinite(flat.floorMedian)).toBe(true);
    expect(Number.isFinite(flat.logRange)).toBe(true);
  });
});

describe("without WebGL2 the engine degrades instead of throwing", () => {
  /*
   * `createEngine` answers a missing context — or a shader that fails to compile — with a no-op
   * engine. Every /explore page that renders gas calls straight into this API, so if the no-op
   * were incomplete the page would throw rather than simply showing nothing.
   *
   * This also stands in for the compile-failure path, which is what a lost decimal point in an
   * interpolated GLSL float produces (see camera.ts's `glslFloat`).
   */
  const scene: Scene = sceneFromParts(
    { volume_log_min: 0, volume_log_max: 4, volume_log_median: 1, volume_log_mean: 2, volume_ngrid: 4, box_pc: 6 },
    new Uint8Array(64),
    new Float32Array(6),
  );
  const noContext = { getContext: () => null } as unknown as HTMLCanvasElement;

  it("returns a complete ClusterEngine, with every method callable", () => {
    const e = createEngine(noContext, scene);
    expect(() => {
      e.setEmit(1); e.setAbsorb(1); e.setFloor(0.5); e.setGamma(1);
      e.setExpel(0.5); e.setExpel(null); e.setStarAlpha(1);
      e.setStars(new Float32Array(6)); e.setStarPositions(new Float32Array(3));
      e.setGasFraction(0.5); e.setView({ yaw: 1 }); e.resetView(); e.redraw(); e.cleanup();
    }).not.toThrow();
  });

  it("still reports the scene metadata a page needs to build its controls", () => {
    /* The floors drive the density-floor slider's range. A no-op engine that returned zeros would
     * give the page a slider with no useful travel — working, and useless. */
    const e = createEngine(noContext, scene);
    expect(e.meta.box).toBe(6);
    expect(e.meta.ngrid).toBe(4);
    expect(e.meta.floors.median).toBeCloseTo(0.25, 12);
    expect(e.meta.floors.mean).toBeCloseTo(0.5, 12);
  });

  it("returns a view inside the engine's own zoom bounds", () => {
    const v = createEngine(noContext, scene).getView();
    expect(v.zoom).toBe(DEFAULT_ZOOM);
    expect(v.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(v.zoom).toBeLessThanOrEqual(ZOOM_MAX);
  });
});
