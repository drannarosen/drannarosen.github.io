/*
 * check-parity.mjs — the GPU shader must agree with the CPU reference.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT OPTIONAL ──
 *
 * ADR 0015 accepted writing every equation TWICE — once as pure TypeScript in Layer 0, once as a
 * TSL graph for the GPU — and it accepted that on one stated condition: "a parity check renders
 * the TSL functions over a known input sweep into a float32 target and compares the readback
 * against the TS reference, so divergence is DETECTED rather than merely unlikely."
 *
 * `viz/starfield/parity.ts` implemented the comparison. Nothing ran it. For months the condition
 * attached to that trade-off was met by discipline — someone remembering to drive the harness by
 * hand from a browser console — which is not detection. This is the missing half.
 *
 * The failure it guards against has already happened once and is recorded on `DEFAULT_AUREOLE`:
 * `amp: 0.06` lived in `core/optics` while the shader used `0.012`, which made "does the GPU match
 * the CPU?" unanswerable by construction. Resolving the optics onto the field fixed THAT
 * divergence; it does nothing about the next one in a different term.
 *
 * ── WHY IT IS NOT IN `prebuild` ──
 *
 * It needs a browser and a dev server. Putting it in `prebuild` would make every `pnpm build` —
 * including the deploy — depend on Chromium starting and a GPU adapter existing, which is a large
 * new way for the site to fail to ship for reasons unrelated to the site. It runs as its own
 * command and its own CI job instead.
 *
 * ── WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ──
 *
 * NOT the maximum error. `parity.ts` explains at length why: float32-versus-float64 plus WGSL
 * transcendentals differing in the last bits put a long thin tail on the distribution, and it
 * lands wherever the profile is nearly flat or an angular term is hypersensitive — a diffraction
 * lobe raised to the 24th power moves by percent for a change in theta of parts per million.
 * Asserting the max is how a healthy renderer gets called broken. A real bug moves the MEDIAN.
 *
 * So: total energy, the median relative error, the perceptual error in 8-bit display levels, and
 * the blue fraction on both sides — that last one because a uniform hue shift leaves energy and
 * per-pixel magnitude almost untouched while making the entire frame the wrong colour, which is
 * exactly the symptom a swizzle or a colour-space mismatch produces.
 *
 * Thresholds are set WITH HEADROOM above measured values rather than fitted to them, the same
 * discipline `check-calibrate` states: a bound copied from a measurement cannot fail.
 *
 * Usage:
 *   pnpm check:parity                 # reuses a dev server on :4321, or starts one
 *   PW_CHROME=/path/to/chrome pnpm check:parity   # explicit browser binary
 */
import { withBrowserPage, makeReporter } from "./lib/browser-harness.mjs";

/*
 * Measured on WebGPU (Apple M2 Max, Chrome for Testing 1234) on 2026-07-26, at 320x320 with 4,000
 * stars. Recorded so a future run can see whether it drifted, not so the bounds can be re-fitted
 * to it.
 *
 *   linear   energy 0.999306   p50 0.0925%
 *   lupton   energy 0.995402   p50 0.2335%   levels mean 0.0631  p999 2.785   blue d 0.0001
 *   asinh    energy 0.996291   p50 0.2836%   levels mean 0.0182  p999 0.859   blue d 0.0002
 */
const CASES = [
  {
    name: "linear radiance",
    opts: {},
    why: "the strong test — full float precision, no transfer to hide a disagreement inside a curve",
    p50: 0.025,
  },
  {
    name: "lupton display",
    opts: { lupton: true },
    why: "the only thing that tests the mirror of luptonRGB, and that no second sRGB encode is applied",
  },
  {
    name: "asinh stretch",
    opts: { scaling: "asinh", whitePoint: 1 },
    why: "createStretchNode shipped unverified while the Lupton node was checked; this closes that",
  },
  /*
   * BOTH BACKENDS, and this case earned its place the hard way.
   *
   * TSL compiles to WGSL and to GLSL, and `WebGPURenderer` falls back to its own WebGL 2 backend
   * where WebGPU is unavailable — roughly 5% of real visitors, and every CI runner without a GPU.
   * ADR 0015 says that fallback is "verified first, before the star graph is built on it, rather
   * than assumed", and it was not: the harness read the framebuffer top-down, which is right for
   * WebGPU and wrong for WebGL 2, and nobody saw it because it was only ever run on a laptop with
   * a GPU. The first CI run reported a 94.8% median error with total energy correct to 0.077%.
   *
   * Running the fallback explicitly means the next backend-specific divergence cannot hide on
   * whichever path the author happens to have.
   */
  {
    name: "linear radiance (WebGL 2 fallback)",
    opts: { forceWebGL: true },
    why: "~5% of visitors and every GPU-less CI runner take this path; ADR 0015 says verify it",
    p50: 0.025,
  },
];

/** Bounds. Each is far above the measured value, and each states what it is protecting. */
const LIMITS = {
  /** Total light. A term dropped or double-counted in the shader moves this immediately. */
  energy: 0.02, //            |1 - energyRatio|; measured 0.0007-0.0046
  /**
   * The median. This is the number a real bug moves, and the DEFAULT here is the display-mode
   * bound — the modes whose error is what a viewer could actually perceive.
   *
   * The LINEAR-RADIANCE modes override it to 2.5%, and the reason is not indulgence. That
   * comparison runs over raw radiance spanning eight decades with a floor at 2% of peak, so it
   * includes deep PSF-wing pixels where a relative error is dominated by the rasteriser's own
   * precision rather than by the shader's arithmetic. Measured medians for that mode:
   *
   *     WebGPU / Metal        0.0925%
   *     WebGL 2 / ANGLE-Metal 0.0921%
   *     WebGL 2 / SwiftShader 1.0764%   <- GitHub's runners, a pure software rasteriser
   *
   * Holding a software rasteriser to a bound measured on a GPU is the same error as asserting
   * bit-identical `Math.pow` across CPU architectures, which broke a deploy earlier the same day.
   * The DISPLAY modes stay at 1% and came in at 0.21-0.39% on that same runner, so the number
   * that bounds what anyone can see is still tight.
   */
  p50: 0.01, //               fraction; measured 0.0009-0.0039 for display modes
  /** Perceptual error, display modes only. One 8-bit level is the smallest visible step. */
  levelsMean: 0.5, //         levels; measured 0.018-0.063
  levelsP999: 8, //           levels; measured 0.86-2.79
  /** Hue. Catches a swizzle or colour-space mismatch that every magnitude metric would miss. */
  blueDelta: 0.01, //         absolute; measured 0.0001-0.0002
  /** Guards against a VACUOUS PASS: an empty frame agrees with an empty frame perfectly. */
  minCompared: 1000,
};

const r = makeReporter("parity (the GPU shader against the CPU reference)");
const { ok, log } = r;

const { pageErrors } = await withBrowserPage(async (page) => {
  /*
   * The backend is REPORTED, not asserted to be WebGPU. Both are legitimate — TSL compiles to WGSL
   * and to GLSL, and `WebGPURenderer` falls back to its own WebGL 2 backend where WebGPU is
   * unavailable (a CI runner with no GPU, ~5% of real visitors). What must never happen is passing
   * without knowing which one ran, so the name is printed and a vacuous comparison is refused
   * below.
   */
  let backendSeen = null;

  for (const c of CASES) {
    let res;
    try {
      res = await page.evaluate(async (opts) => {
        const mod = await import("/src/novascope/viz/starfield/parity.ts");
        return await mod.runParity({ width: 320, height: 320, starCount: 4000, ...opts });
      }, c.opts);
    } catch (e) {
      ok(false, `${c.name}: the harness threw — ${String(e).slice(0, 200)}`);
      continue;
    }
    backendSeen = res.backend;

    log(`\n  ${c.name} [${res.backend}] — ${c.why}`);
    ok(
      res.compared >= LIMITS.minCompared,
      `${res.compared.toLocaleString()} pixels compared (a near-empty frame would agree trivially)`,
    );
    ok(
      Math.abs(1 - res.energyRatio) <= LIMITS.energy,
      `total light agrees to ${(100 * Math.abs(1 - res.energyRatio)).toFixed(3)}% ` +
        `(limit ${100 * LIMITS.energy}%)`,
    );
    const p50Limit = c.p50 ?? LIMITS.p50;
    ok(
      res.percentiles.p50 <= p50Limit,
      `median pixel error ${(100 * res.percentiles.p50).toFixed(4)}% (limit ${100 * p50Limit}%) ` +
        `— p90 ${(100 * res.percentiles.p90).toFixed(3)}%, p99 ${(100 * res.percentiles.p99).toFixed(2)}%, ` +
        `max ${(100 * res.percentiles.max).toFixed(1)}% (tail NOT asserted; see header)`,
    );
    if (res.levels) {
      ok(
        res.levels.mean <= LIMITS.levelsMean,
        `mean display error ${res.levels.mean.toFixed(4)} of one 8-bit level (limit ${LIMITS.levelsMean})`,
      );
      ok(
        res.levels.p999 <= LIMITS.levelsP999,
        `99.9th-percentile display error ${res.levels.p999.toFixed(3)} levels (limit ${LIMITS.levelsP999})`,
      );
    }
    if (res.blueFraction) {
      const d = Math.abs(res.blueFraction.gpu - res.blueFraction.cpu);
      ok(
        d <= LIMITS.blueDelta,
        `blue fraction agrees to ${d.toFixed(5)} ` +
          `(gpu ${res.blueFraction.gpu.toFixed(4)} vs cpu ${res.blueFraction.cpu.toFixed(4)}, ` +
          `limit ${LIMITS.blueDelta}) — a swizzle would show here and nowhere else`,
      );
    }
  }

  ok(backendSeen !== null, `a GPU backend was obtained (${backendSeen ?? "none"})`);
  return null;
}, { log });

ok(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors[0].slice(0, 160)}` : ""}`);

r.finish(
  `parity ok — the GPU and the CPU reference agree across ${CASES.length} modes.`,
  "  Before suspecting the renderer, read parity.ts's header: a LARGE spatial error with\n" +
    "  CORRECT total energy means the harness, not the shader (row order, or a readback width\n" +
    "  whose bytes-per-row is not a multiple of 256).",
);
