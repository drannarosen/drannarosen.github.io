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
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";

const PORT = Number(process.env.PARITY_PORT ?? 4321);
const ORIGIN = `http://localhost:${PORT}`;

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

const log = (s = "") => console.log(s);
let failures = 0;
const ok = (cond, msg) => {
  log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

/* ── The dev server. `parity.ts` is dev-only by design (the production build tree-shakes it away),
 * and it needs Vite to resolve `three`, so `dist/` cannot serve it. ── */
async function serverUp() {
  try {
    const r = await fetch(ORIGIN, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

let startedByUs = false;
async function ensureServer() {
  if (await serverUp()) {
    log(`  reusing the dev server already on ${ORIGIN}`);
    return;
  }
  log(`  starting a dev server on ${ORIGIN}…`);
  spawn("pnpm", ["exec", "astro", "dev", "--background", "--port", String(PORT)], {
    stdio: "ignore",
    detached: false,
  });
  startedByUs = true;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await serverUp()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `the dev server did not come up on ${ORIGIN} within 90s.\n` +
      `Start one yourself with 'pnpm dev' and re-run, or set PARITY_PORT.`,
  );
}

function stopServerIfWeStartedIt() {
  if (!startedByUs) return;
  spawnSync("pnpm", ["exec", "astro", "dev", "stop"], { stdio: "ignore" });
}

log("parity (the GPU shader against the CPU reference):");

await ensureServer();

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    /*
     * PW_CHROME exists because `npx playwright install` cannot always fetch a binary (a locked-down
     * or offline machine). Pointing at an existing Chrome/Chromium is the escape hatch. There is
     * deliberately NO silent skip when the browser is missing: a parity gate that quietly does
     * nothing is worse than no parity gate, because it reads as coverage.
     */
    ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
  });
} catch (e) {
  console.error(
    `\n✗ parity — could not launch Chromium: ${String(e).split("\n")[0]}\n` +
      `  Install it with 'npx playwright install chromium', or set PW_CHROME to a browser binary.\n` +
      `  This gate does NOT skip when the browser is missing — see its header.`,
  );
  stopServerIfWeStartedIt();
  process.exit(1);
}

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });

  /*
   * The backend is REPORTED, not asserted to be WebGPU. Both are legitimate — TSL compiles to WGSL
   * and to GLSL, and `WebGPURenderer` falls back to its own WebGL 2 backend where WebGPU is
   * unavailable (a CI runner with no GPU, ~5% of real visitors). What must never happen is passing
   * without knowing which one ran, so the name is printed and a vacuous comparison is refused
   * below.
   */
  let backendSeen = null;

  for (const c of CASES) {
    let r;
    try {
      r = await page.evaluate(async (opts) => {
        const mod = await import("/src/novascope/viz/starfield/parity.ts");
        return await mod.runParity({ width: 320, height: 320, starCount: 4000, ...opts });
      }, c.opts);
    } catch (e) {
      ok(false, `${c.name}: the harness threw — ${String(e).slice(0, 200)}`);
      continue;
    }
    backendSeen = r.backend;

    log(`\n  ${c.name} [${r.backend}] — ${c.why}`);
    ok(
      r.compared >= LIMITS.minCompared,
      `${r.compared.toLocaleString()} pixels compared (a near-empty frame would agree trivially)`,
    );
    ok(
      Math.abs(1 - r.energyRatio) <= LIMITS.energy,
      `total light agrees to ${(100 * Math.abs(1 - r.energyRatio)).toFixed(3)}% ` +
        `(limit ${100 * LIMITS.energy}%)`,
    );
    const p50Limit = c.p50 ?? LIMITS.p50;
    ok(
      r.percentiles.p50 <= p50Limit,
      `median pixel error ${(100 * r.percentiles.p50).toFixed(4)}% (limit ${100 * p50Limit}%) ` +
        `— p90 ${(100 * r.percentiles.p90).toFixed(3)}%, p99 ${(100 * r.percentiles.p99).toFixed(2)}%, ` +
        `max ${(100 * r.percentiles.max).toFixed(1)}% (tail NOT asserted; see header)`,
    );
    if (r.levels) {
      ok(
        r.levels.mean <= LIMITS.levelsMean,
        `mean display error ${r.levels.mean.toFixed(4)} of one 8-bit level (limit ${LIMITS.levelsMean})`,
      );
      ok(
        r.levels.p999 <= LIMITS.levelsP999,
        `99.9th-percentile display error ${r.levels.p999.toFixed(3)} levels (limit ${LIMITS.levelsP999})`,
      );
    }
    if (r.blueFraction) {
      const d = Math.abs(r.blueFraction.gpu - r.blueFraction.cpu);
      ok(
        d <= LIMITS.blueDelta,
        `blue fraction agrees to ${d.toFixed(5)} ` +
          `(gpu ${r.blueFraction.gpu.toFixed(4)} vs cpu ${r.blueFraction.cpu.toFixed(4)}, ` +
          `limit ${LIMITS.blueDelta}) — a swizzle would show here and nowhere else`,
      );
    }
  }

  if (pageErrors.length) {
    ok(false, `the page logged ${pageErrors.length} error(s): ${pageErrors[0].slice(0, 200)}`);
  }
  ok(backendSeen !== null, `a GPU backend was obtained (${backendSeen ?? "none"})`);
} finally {
  await browser.close();
  stopServerIfWeStartedIt();
}

if (failures) {
  console.error(`\n✗ parity — ${failures} failure(s). The TSL graph and the TS reference disagree.`);
  console.error(
    `  Before suspecting the renderer, read parity.ts's header: a LARGE spatial error with\n` +
      `  CORRECT total energy means the harness, not the shader (row order, or a readback width\n` +
      `  whose bytes-per-row is not a multiple of 256).`,
  );
  process.exit(1);
}
console.log(`\n✓ parity ok — the GPU and the CPU reference agree across ${CASES.length} modes.`);
