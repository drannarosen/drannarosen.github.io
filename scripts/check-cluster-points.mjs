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
 * ── BOTH BACKENDS, AGAINST ONE STORED BASELINE ──
 *
 * TSL compiles to WGSL and to GLSL and `WebGPURenderer` falls back to its own WebGL 2 backend
 * where WebGPU is unavailable. `check-parity` records what happens when only one path is ever
 * exercised: a 94.8% median error that hid for months because the author's laptop had a GPU. Both
 * are compared here against the SAME fixture, so neither can drift alone.
 *
 * ── THE BOUNDS ARE NOT FITTED TO THE MEASUREMENT ──
 *
 * Measured on Apple M2 Max / Chrome, 2026-08-09, 320x320, 400 stars:
 *
 *   webgpu vs webgpu   sumRatio 1.000000    maxCell 0        rms 0
 *   webgpu vs webgl2   sumRatio 1.0000033   maxCell 0.0175   rms 0.0025    (grid peak 196.3)
 *
 * Within a backend it is BIT-IDENTICAL. Exact equality is still not asserted: a driver or GPU
 * change may move the last bits with nothing wrong, and a bound that only holds on one laptop is
 * worse than no bound — the lesson `check-parity` learned from SwiftShader on CI. Each bound below
 * sits far above what was measured and says what it protects.
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
  /** Total light. A dropped or double-counted term moves this at once. Measured 3.3e-6. */
  sum: 0.002,
  /**
   * The worst single cell, in 8-bit display levels. One level is the smallest step anyone can
   * see, so this is the bound that says "no visible change". Measured 0.0175 across backends.
   */
  maxCell: 1.0,
  /** The bulk. A uniform shift too small to trip maxCell still moves this. Measured 0.0025. */
  rmsCell: 0.25,
  /**
   * Guards against the VACUOUS PASS, which is the failure mode this whole gate is most exposed
   * to: a blank frame agrees with a blank frame perfectly, and a renderer that silently drew
   * nothing after the refactor would otherwise pass every bound above.
   */
  minSum: 1e6,
  minLit: 5000,
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

if (UPDATE || !existsSync(FIXTURE)) {
  const payload = {
    _comment:
      "Pinned output of viz/clusterPoints. Regenerate with `pnpm check:cluster-points --update` " +
      "ONLY when the renderer was deliberately changed, and review the diff — this file is the " +
      "only thing standing between a renderer refactor and a silently different /explore/dynamics.",
    size: result.size,
    grid: result.grid,
    capturedOn: backends.webgpu,
    cases: Object.fromEntries(
      Object.entries(result.webgpu).map(([id, s]) => [
        id,
        { sum: s.sum, litPixels: s.litPixels, grid: s.grid },
      ]),
    ),
  };
  writeFileSync(FIXTURE, `${JSON.stringify(payload, null, 1)}\n`);
  log(`  ${existsSync(FIXTURE) && !UPDATE ? "created" : "updated"} ${FIXTURE}`);
  if (!UPDATE) log("  (fixture did not exist — captured it; re-run to compare against it)");
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

ok(fixture.size === result.size, `canvas size matches the fixture (${fixture.size})`);
ok(fixture.grid === result.grid, `grid resolution matches the fixture (${fixture.grid})`);

const why = Object.fromEntries(result.cases.map((c) => [c.id, c.why]));

for (const [backend, shots] of Object.entries({ webgpu: result.webgpu, webgl2: result.webgl2 })) {
  for (const [id, shot] of Object.entries(shots)) {
    const ref = fixture.cases[id];
    if (!ref) {
      ok(false, `${backend}/${id}: no such case in the fixture — re-pin with --update`);
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

r.finish(
  "cluster-points ok — the renderer draws what it was pinned drawing",
  "  If the change was DELIBERATE, re-pin with `pnpm check:cluster-points --update` and review\n" +
    "  the diff. If it was not, /explore/dynamics has just changed and nobody asked it to.",
);
