/*
 * check-cluster-points.mjs — `viz/clusterPoints` must keep drawing what it draws today.
 *
 * ── WHY THIS EXISTS ──
 *
 * `clusterPoints` is being refactored to accept an EXTERNAL renderer so the gas volume and the
 * stars can share one three.js scene (docs/plans/2026-08-09-feedback-volumetric-renderer-design.md,
 * step 1). It ships on /explore/dynamics today, so that refactor is the largest regression risk in
 * the plan — and the kind that does not throw. A renderer wired to a slightly different context
 * still renders; it renders a slightly different picture, on a page whose claim is where the
 * massive stars are.
 *
 * The plan's step 1 is "pin the baseline, and nothing else starts until it exists". This is it.
 *
 * ── WHAT IT COMPARES, AND WHY NOT A SCREENSHOT OF THE PAGE ──
 *
 * The subject is the RENDERER, driven by a fixed lattice of numbers with no integrator anywhere
 * near it. `__fixtures__/clusterPointsBaseline.ts` explains why at length: an N-body frame is not
 * reproducible across engines by ~39,000 steps, so a pin on one would fail for reasons that have
 * nothing to do with rendering, and a gate that cries wolf gets deleted.
 *
 * ── BOTH BACKENDS, EACH AGAINST ITS OWN BASELINE ──
 *
 * TSL compiles to WGSL and to GLSL and `WebGPURenderer` falls back to its own WebGL 2 backend
 * where WebGPU is unavailable. `check-parity` records what happens when only one path is ever
 * exercised: a 94.8% median error that hid for months because the author's laptop had a GPU.
 *
 * Both run here, and each is pinned SEPARATELY. A single shared baseline was tried first and was
 * wrong: the two rasterisers legitimately differ, so one baseline makes every run on the other
 * backend a false failure.
 *
 * ── WEBGPU NEEDS A REAL BROWSER, AND THAT IS EASY TO MISS ──
 *
 * Playwright's BUNDLED Chromium has no WebGPU adapter (the API is present on a secure origin;
 * `requestAdapter()` returns null). Point it at the system Chrome and a real device appears,
 * headless included — measured 2026-08-09:
 *
 *   bundled headless                 gpu true, adapter NULL
 *   bundled headless + unsafe-webgpu adapter google / swiftshader   (software)
 *   system Chrome headless           adapter apple  / metal-3       (hardware)
 *
 * `browser-harness` therefore reaches for the system Chrome BY DEFAULT, through Playwright's own
 * `channel`, so a plain `pnpm check:cluster-points` captures the WebGPU half with no environment
 * variable to remember. `PW_CHROME=<path>` still overrides it for a browser that channel lookup
 * does not know about.
 *
 * That default is new, and the paragraph here used to say the opposite — that a run without
 * PW_CHROME "takes WebGL 2 for both passes AND falls back to a software rasteriser, so it fails
 * the rasteriser check rather than half-passing". True when written, and true still on a machine
 * with no system Chrome, where the harness now says so on stderr instead of leaving the failure to
 * be decoded. What made it worth changing is that it failed by DEFAULT on a developer machine that
 * had Chrome sitting right there, and a gate that always fails locally is a gate nobody runs.
 *
 * (A caution about probing this: `about:blank` is not a secure context, so `navigator.gpu` is
 * undefined there for reasons that have nothing to do with the browser or the flags. A probe that
 * does not navigate to the dev server first will report WebGPU as universally unavailable, which
 * is exactly what happened on the first attempt here.)
 *
 * ── THE BOUNDS ARE NOT FITTED TO THE MEASUREMENT ──
 *
 * Measured on Apple M2 Max, 320x320, 400 stars, 40x40 grid, 2026-08-09:
 *
 *   within a backend, repeated        maxCell 0        (bit-identical)
 *   webgpu vs webgl2, SAME browser    base 0.073   alpha 0.063   trail 5.896
 *   webgl2 hardware vs SwiftShader    base 1.526   alpha 1.750   trail 8.719
 *
 * Within a backend it is BIT-IDENTICAL, which is what makes the per-backend bound tight. Exact
 * equality is still not asserted: a driver change may move the last bits with nothing wrong, and
 * a bound that only holds on one laptop is worse than no bound.
 *
 * Read the last two rows together, because the ordering is the point: CHANGING THE RASTERISER
 * MOVES THE IMAGE MORE THAN CHANGING THE BACKEND DOES. Only the trail is genuinely
 * backend-sensitive, line rasterisation being where WGSL and GLSL diverge most; the point
 * material agrees to 0.07 of a level across backends and to 1.5 across rasterisers.
 *
 * Two claims were made here and withdrawn before that was understood — first that the backends
 * agreed to 0.0175 of a level (a 16x16 grid over the base case alone, cells averaging 400 px
 * instead of 64, no line material), then that a 1.53-level difference was a backend effect when
 * it was software-versus-hardware. Both were real measurements generalised past what they
 * measured.
 *
 * Usage:
 *   pnpm check:cluster-points              # compare against the fixture
 *   pnpm check:cluster-points --update     # re-pin (only with a reason, and review the diff)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withBrowserPage, makeReporter } from "./lib/browser-harness.mjs";

const FIXTURE = fileURLToPath(
  new URL("../src/novascope/viz/__fixtures__/cluster-points-baseline.json", import.meta.url),
);
const UPDATE = process.argv.includes("--update");

/** Bounds. Each far above measured, each stating what it is for. */
const LIMITS = {
  /** Total light. A dropped or double-counted term moves this at once. Measured 0 on the pin. */
  sum: 0.002,
  /**
   * The worst single cell, in 8-bit display levels. One level is the smallest step anyone can
   * see, so this is the bound that says "no visible change". Measured 0 against the pinned
   * rasteriser, which is why 1.0 is generous rather than tight-fitted.
   */
  maxCell: 1.0,
  /** The bulk. A uniform shift too small to trip maxCell still moves this. Measured 0 on the pin. */
  rmsCell: 0.25,
  /**
   * Guards against the VACUOUS PASS, which is the failure mode this whole gate is most exposed
   * to: a blank frame agrees with a blank frame perfectly, and a renderer that silently drew
   * nothing after the refactor would otherwise pass every bound above.
   */
  minSum: 1e6,
  minLit: 5000,
  /**
   * How far the two backends may drift APART. Not a correctness bound — they are different
   * rasterisers and are expected to differ — but a bound on how far, so that "WebGL 2 visitors see
   * essentially this picture" stays a measurement. Measured 0.063-5.896, the trail dominating.
   */
  crossMaxCell: 12,
  crossSum: 0.01,
};

const r = makeReporter("cluster-points (the star renderer, pinned before it is refactored)");
const { ok, log } = r;

const { result, pageErrors } = await withBrowserPage(
  async (page) => {
    return page.evaluate(async () => {
      const mod = await import("/src/novascope/viz/__fixtures__/clusterPointsBaseline.ts");
      return {
        cases: mod.BASELINE_CASES,
        size: mod.BASELINE_SIZE,
        grid: mod.BASELINE_GRID,
        /*
         * The RASTERISER, not the browser version — the causal variable. Playwright's bundled
         * Chromium and the system Chrome both report HeadlessChrome/151 while producing images
         * 8.7 levels apart, so a UA string does not discriminate them. The unmasked WebGL
         * renderer names ANGLE's backing device, which is exactly what differs.
         */
        rasteriser: (() => {
          const c = document.createElement("canvas");
          const gl = c.getContext("webgl2");
          if (!gl) return "no-webgl2";
          const ext = gl.getExtension("WEBGL_debug_renderer_info");
          return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "masked";
        })(),
        webgpu: await mod.captureAll({}),
        webgl2: await mod.captureAll({ forceWebGL: true }),
      };
    });
  },
  { log },
);

for (const e of pageErrors) ok(false, `page error: ${e}`);

/* The device must actually have come up. `captureBaseline` REPORTS a failure to become ready
   rather than throwing, precisely so this reads as "the device never came up" instead of as a
   comparison against a blank frame. */
for (const [backend, shots] of Object.entries({ webgpu: result.webgpu, webgl2: result.webgl2 })) {
  for (const [id, s] of Object.entries(shots)) {
    ok(s.ready, `${backend}/${id}: device ready, ${s.frames} frame(s) presented`);
  }
}

/* Which backend actually ran is REPORTED, never assumed. A machine without WebGPU takes the
   fallback for both passes, and a gate that claimed to have covered two paths while covering one
   is the exact thing check-parity exists to prevent. */
const backends = {
  webgpu: result.webgpu.base.backend,
  webgl2: result.webgl2.base.backend,
};
log(`  backends: requested webgpu -> ${backends.webgpu}, forced webgl2 -> ${backends.webgl2}`);
ok(
  backends.webgl2 === "webgl2",
  `the forced pass really took the WebGL 2 fallback (got ${backends.webgl2})`,
);
if (backends.webgpu !== "webgpu") {
  log("  NOTE: WebGPU was unavailable, so both passes ran on WebGL 2 — coverage is one path.");
}

/*
 * ── ONE BASELINE PER BACKEND, AND THE COMPARISON KEYS OFF WHAT ACTUALLY RAN ──
 *
 * The first version of this gate stored ONE baseline and asserted the backends agreed within a
 * display level, on the strength of a 0.0175-level measurement. That measurement was taken on a
 * 16x16 grid over the base case alone — cells averaging 400 px instead of 64, and no trail. With a
 * real WebGPU device and the shipped 40x40 grid the true figures are:
 *
 *     base   maxCell 1.53   rms 0.218
 *     trail  maxCell 5.80   rms 0.468      <- line rasterisation differs most
 *     alpha  maxCell 1.75
 *
 * So they do NOT agree to a level, and a single baseline would have made every run on the other
 * backend a false failure. Each backend is pinned against its own capture, and the cross-backend
 * difference is REPORTED against a bound of its own rather than assumed to be negligible.
 *
 * Keying off the REPORTED backend rather than the requested one matters: without PW_CHROME the
 * bundled Chromium has no WebGPU adapter, both passes take WebGL 2, and comparing a WebGL 2 frame
 * against a WebGPU baseline would fail for the wrong reason entirely.
 */
const shotsByBackend = {};
for (const shots of [result.webgpu, result.webgl2]) {
  for (const [id, s] of Object.entries(shots)) {
    (shotsByBackend[s.backend] ??= {})[id] = s;
  }
}

if (UPDATE || !existsSync(FIXTURE)) {
  const prior = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;
  const payload = {
    _comment:
      "Pinned output of viz/clusterPoints, ONE BASELINE PER BACKEND. Regenerate with " +
      "`pnpm check:cluster-points --update` ONLY when the renderer was deliberately changed, and " +
      "review the diff — this file is the only thing standing between a renderer refactor and a " +
      "silently different /explore/dynamics. Capturing the webgpu half needs a real adapter: " +
      "PW_CHROME=/path/to/Google\\ Chrome pnpm check:cluster-points --update",
    size: result.size,
    grid: result.grid,
    /* The browser is PART OF THE PIN. See CAPTURE_BROWSER below for why. */
    rasteriser: result.rasteriser,
    backends: {
      /* Merge, never clobber: a run without PW_CHROME can only re-pin webgl2, and silently
         dropping the webgpu half would quietly halve the gate's coverage. */
      ...(prior?.backends ?? {}),
      ...Object.fromEntries(
        Object.entries(shotsByBackend).map(([backend, shots]) => [
          backend,
          Object.fromEntries(
            Object.entries(shots).map(([id, s]) => [
              id,
              { sum: s.sum, litPixels: s.litPixels, grid: s.grid },
            ]),
          ),
        ]),
      ),
    },
  };
  writeFileSync(FIXTURE, `${JSON.stringify(payload, null, 1)}\n`);
  log(`  wrote ${FIXTURE} (backends pinned: ${Object.keys(payload.backends).join(", ")})`);
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

ok(fixture.size === result.size, `canvas size matches the fixture (${fixture.size})`);
ok(fixture.grid === result.grid, `grid resolution matches the fixture (${fixture.grid})`);
ok(
  Boolean(fixture.backends?.webgpu),
  "the fixture pins the WebGPU path (re-pin with PW_CHROME set if this fails)",
);

/*
 * ── THE BROWSER IS PART OF THE PIN, AND THAT IS NOT A DETAIL ──
 *
 * A pixel baseline is only meaningful against the rasteriser that produced it. Measured 2026-08-09
 * with the BACKEND HELD FIXED at webgl2 and only the browser changed — Playwright's bundled
 * Chromium against the system Chrome:
 *
 *     base   1.526 levels        trail   8.719 levels (rms 0.509)
 *
 * That is LARGER than the difference between webgpu and webgl2 inside one browser (0.073 on base).
 * Two claims were made and withdrawn here before that was understood: first that the backends
 * agreed to 0.0175 of a level, then that a 1.53-level difference was a backend effect. Both were
 * real measurements generalised past what they measured.
 *
 * So the fixture records its browser and a mismatch FAILS with instructions, rather than skipping.
 * A gate that quietly does nothing on the wrong browser reads as coverage while providing none,
 * which is the thing `browser-harness.mjs` refuses to do about a missing Chromium.
 */
const wantR = fixture.rasteriser ?? "";
const gotR = result.rasteriser;
ok(wantR === gotR, `rasteriser matches the pin (${gotR})`);
if (wantR !== gotR) {
  log(`  pinned:  ${wantR}`);
  log(`  running: ${gotR}`);
  log("");
  log("  The baseline was captured on a different browser build, so every per-cell comparison");
  log("  below is meaningless. Re-run with the browser the fixture names:");
  log('    PW_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\');
  log("      pnpm check:cluster-points");
  log("  Playwright's bundled Chromium also has no WebGPU adapter, so it can only ever cover");
  log("  half of this gate. `npx playwright install chrome` provides the real one on CI.");
  log("");
}

const why = Object.fromEntries(result.cases.map((c) => [c.id, c.why]));

for (const [backend, shots] of Object.entries(shotsByBackend)) {
  for (const [id, shot] of Object.entries(shots)) {
    const ref = fixture.backends?.[backend]?.[id];
    if (!ref) {
      ok(false, `${backend}/${id}: no baseline for this backend — re-pin with --update`);
      continue;
    }

    ok(
      shot.sum > LIMITS.minSum && shot.litPixels > LIMITS.minLit,
      `${backend}/${id}: frame is not blank (${shot.litPixels} lit px, sum ${shot.sum.toExponential(3)})`,
    );

    const sumRatio = shot.sum / ref.sum;
    let maxCell = 0;
    let sse = 0;
    for (let i = 0; i < ref.grid.length; i++) {
      const d = Math.abs(shot.grid[i] - ref.grid[i]);
      if (d > maxCell) maxCell = d;
      sse += d * d;
    }
    const rms = Math.sqrt(sse / ref.grid.length);

    ok(
      Math.abs(1 - sumRatio) <= LIMITS.sum,
      `${backend}/${id}: total light within ${LIMITS.sum} (|1-ratio| = ${Math.abs(1 - sumRatio).toExponential(2)})`,
    );
    ok(
      maxCell <= LIMITS.maxCell,
      `${backend}/${id}: worst cell within ${LIMITS.maxCell} level (${maxCell.toFixed(4)}) — ${why[id]}`,
    );
    ok(rms <= LIMITS.rmsCell, `${backend}/${id}: rms within ${LIMITS.rmsCell} (${rms.toFixed(4)})`);
  }
}

/*
 * How far apart the two backends are — reported whenever both really ran.
 *
 * This is the number that says what a WebGL 2 visitor actually sees, and it is the one thing a
 * per-backend pin cannot tell you: two baselines that each match themselves perfectly could still
 * be two different pictures.
 */
if (shotsByBackend.webgpu && shotsByBackend.webgl2) {
  for (const { id, why: reason } of result.cases) {
    const a = shotsByBackend.webgpu[id];
    const b = shotsByBackend.webgl2[id];
    if (!a || !b) continue;
    let maxCell = 0;
    for (let i = 0; i < a.grid.length; i++) {
      const d = Math.abs(a.grid[i] - b.grid[i]);
      if (d > maxCell) maxCell = d;
    }
    const sumRatio = b.sum / a.sum;
    ok(
      maxCell <= LIMITS.crossMaxCell && Math.abs(1 - sumRatio) <= LIMITS.crossSum,
      `cross-backend/${id}: webgl2 within ${LIMITS.crossMaxCell} levels of webgpu ` +
        `(${maxCell.toFixed(3)}, total light ${((sumRatio - 1) * 100).toFixed(3)}%) — ${reason}`,
    );
  }
} else {
  log("  cross-backend comparison SKIPPED — only one backend ran (set PW_CHROME for WebGPU).");
}

r.finish(
  "cluster-points ok — the renderer draws what it was pinned drawing",
  "  If the change was DELIBERATE, re-pin with `pnpm check:cluster-points --update` and review\n" +
    "  the diff. If it was not, /explore/dynamics has just changed and nobody asked it to.",
);
