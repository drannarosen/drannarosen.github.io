/*
 * clusterPointsBaseline.ts — what `viz/clusterPoints` draws, pinned (dev-only, Layer 2).
 *
 * ── WHY THIS EXISTS ──
 *
 * `clusterPoints` is about to be refactored to accept an EXTERNAL renderer, so that the gas
 * volume and the stars can share one three.js scene (see
 * `docs/plans/2026-08-09-feedback-volumetric-renderer-design.md`). That file ships on
 * /explore/dynamics today, which makes it the single largest regression risk in that plan.
 *
 * "I did not break dynamics" has to be a MEASUREMENT. This is the measurement.
 *
 * ── IT PINS THE RENDERER, NOT THE PAGE ──
 *
 * The obvious pin — screenshot /explore/dynamics — cannot work, and the reason is recorded in
 * CLAUDE.md: identical initial conditions to 21 significant digits still send node and Chrome into
 * different close encounters by ~39,000 steps. A pin on a simulated frame would fail for reasons
 * that have nothing to do with the renderer, which is the fastest way to get a gate deleted.
 *
 * So the model is a real cluster CAPTURED ONCE and frozen as data — physically real, but inert, so
 * no integrator and no `star()` call runs at check time. Every quantity `clusterPoints` consumes
 * (`x/y/z`, `color`, `sizePx`, `alpha`) is read from the fixture outright. What is being pinned is
 * the mapping from those numbers to pixels, which is exactly and only what the refactor touches.
 *
 * ── WHY `drawImage` AND NOT `readRenderTargetPixelsAsync` ──
 *
 * `clusterPoints` owns its renderer privately and exposes no render target, and adding a readback
 * to its public API to satisfy a test would mean modifying the very file being pinned.
 *
 * Compositing the canvas through a 2-D context avoids that, and it happens to sidestep
 * `starfield/parity.ts`'s TRAP 1 as well: the row-order disagreement between the backends is a
 * property of `readRenderTargetPixelsAsync`, whereas a canvas presents in display orientation on
 * both. Measured 2026-08-09 — webgpu against webgl2 needed no flip.
 *
 * ── MEASURED, so a future run can see drift rather than re-fit the bounds to it ──
 *
 * Apple M2 Max, system Chrome, 2026-08-09, 320x320, 40x40 grid, worst cell in 8-bit display
 * levels. NOTE these were taken on the earlier invented lattice; the frozen real cluster re-pins
 * the absolute images but the cross-backend STRUCTURE below held:
 *
 *   within a backend, repeated        maxCell 0        (bit-identical)
 *   webgpu vs webgl2, SAME browser    base 0.073   alpha 0.063   trail 5.896
 *   webgl2 hardware vs SwiftShader    base 1.526   alpha 1.750   trail 8.719
 *
 * The within-backend result is BIT-IDENTICAL, which is what makes a tight bound defensible.
 *
 * The ordering of the last two rows is the finding: CHANGING THE RASTERISER MOVES THE IMAGE MORE
 * THAN CHANGING THE BACKEND DOES. Only the trail is genuinely backend-sensitive — line
 * rasterisation is where WGSL and GLSL diverge most. So the baseline is stored per backend AND
 * the rasteriser is part of the pin; `check-cluster-points.mjs` refuses to compare against a
 * different one rather than reporting a difference it cannot attribute.
 *
 * ── A HIDDEN TAB IS FINE HERE, WHICH IS NOT GENERALLY TRUE ──
 *
 * Nothing below awaits `requestAnimationFrame`. A hidden tab starves rAF, and the first version of
 * this probe hung on exactly that. `redraw()` presents synchronously enough to be read afterwards,
 * verified with `document.hidden === true`.
 */
import { createClusterPoints } from "../clusterPoints.ts";
import type { RenderModel, RenderStar } from "../../state/render.ts";
import frozen from "./cluster-points-model.json" with { type: "json" };

/** Canvas edge [px]. 320 keeps `320 * 16` byte rows aligned if this ever moves to a render target. */
export const BASELINE_SIZE = 320;
/** Mean-pool grid edge. 40 gives 8x8 px cells — fine enough that one star's change survives. */
export const BASELINE_GRID = 40;
/**
 * Framing radius — the SCENARIO's `viewPc`, which is what /explore/dynamics frames on
 * ("the scenario's own `viewPc`, FIXED"), and not the model's `maxR`. They differ: 2.60 pc
 * against 1.35 pc, so framing on `maxR` would pin a view twice as tight as the page's and would
 * push the outer cluster off the edge of the very frame meant to protect it.
 */
const BASELINE_RADIUS_PC = frozen.viewPc;

/**
 * The model — a REAL cluster, frozen.
 *
 * The first version of this generated its own lattice from a seeded LCG. It was deterministic,
 * which was the only property it was designed for, and Anna spotted immediately that it looked
 * nothing like the clusters on /explore/dynamics and /explore/census. Measured against
 * `presets.default`, she was right about more than the look:
 *
 *                        real                     invented
 *   colour (b-r) p50     -0.46  warm, red-heavy   -0.05  neutral (green was HARDCODED at 0.7)
 *   sizePx p50 / p90      1.35 / 2.40  steep       2.71 / 4.53  most stars LARGE
 *   alpha                 0.55-0.70    floored     0.30-1.00    uniform
 *
 * That is a defect in the PIN and not only in the picture. This renderer's law is a
 * `sizePx`-driven halo over a core with alpha FLOORED so "the faint majority is always visible" —
 * so a fixture whose stars are mostly large and mostly opaque never exercises the regime that law
 * exists for, and a regression in the faint tail would have passed.
 *
 * `scripts/reference/gen-cluster-points-model.mjs` captured the real pipeline's output once. It is
 * inert data now, so the renderer's baseline cannot move when the IMF sampler or `star()` changes
 * — which is the property the invented lattice was reaching for, obtained without giving up being
 * physically real.
 */
export function baselineModel(): RenderModel {
  const stars: RenderStar[] = [];
  for (let i = 0; i < frozen.n; i++) {
    stars.push({
      id: i,
      x: frozen.xyz[i * 3]!,
      y: frozen.xyz[i * 3 + 1]!,
      z: frozen.xyz[i * 3 + 2]!,
      color: [frozen.rgb[i * 3]!, frozen.rgb[i * 3 + 1]!, frozen.rgb[i * 3 + 2]!],
      sizePx: frozen.sizePx[i]!,
      alpha: frozen.alpha[i]!,
      isRemnant: frozen.remnant[i] === 1,
    });
  }
  return { stars, maxR: frozen.maxR };
}

/** A world-space polyline, so the trail material is pinned too and not merely the points. */
export function baselineTrail(): Float32Array {
  const n = 64;
  const xyz = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 3;
    xyz[i * 3] = 1.2 * Math.cos(t) * (1 - i / n);
    xyz[i * 3 + 1] = 1.2 * Math.sin(t) * (1 - i / n);
    xyz[i * 3 + 2] = -1 + (2 * i) / n;
  }
  return xyz;
}

/** Per-instance alpha ramp — pins `setAlpha`, the path /explore/dynamics uses every frame. */
export function baselineAlpha(): Float32Array {
  const a = new Float32Array(frozen.n);
  for (let i = 0; i < frozen.n; i++) a[i] = i % 3 === 0 ? 0.05 : 1;
  return a;
}

export type BaselineCaseId = "base" | "trail" | "alpha";

/** The cases. Each names what it would catch, because a case that catches nothing is noise. */
export const BASELINE_CASES: readonly { id: BaselineCaseId; why: string }[] = [
  { id: "base", why: "the instanced point material — sizes, colours, the halo/core falloff" },
  { id: "trail", why: "the line material, which is a SEPARATE material and dies separately" },
  { id: "alpha", why: "setAlpha, the per-frame path dynamics uses to fade unbound stars" },
];

export interface BaselineShot {
  backend: "webgpu" | "webgl2";
  /** Sum of mean-RGB over every pixel. Moves the instant a term is dropped or double-counted. */
  sum: number;
  /** Pixels with any light. Guards the vacuous pass: an empty frame matches an empty frame. */
  litPixels: number;
  /** BASELINE_GRID^2 mean-pooled luminances, row-major from the top-left. */
  grid: number[];
  ready: boolean;
  frames: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Render one case and read it back.
 *
 * `onReady` is awaited rather than assumed: a WebGPU device is acquired asynchronously and the
 * framing is meaningless until it resolves — `clusterPoints` documents a scale bar reading
 * "200 pc" on a 0.65 pc cluster for exactly this reason. If it never fires, `ready: false` is
 * REPORTED rather than thrown, so the gate can say "the device never came up" instead of failing
 * with a comparison against a blank frame.
 */
export async function captureBaseline(
  caseId: BaselineCaseId,
  opts: { forceWebGL?: boolean } = {},
): Promise<BaselineShot> {
  const model = baselineModel();
  const canvas = document.createElement("canvas");
  canvas.width = BASELINE_SIZE;
  canvas.height = BASELINE_SIZE;
  canvas.style.width = `${BASELINE_SIZE}px`;
  canvas.style.height = `${BASELINE_SIZE}px`;
  canvas.style.position = "fixed";
  canvas.style.left = "-9999px";
  document.body.appendChild(canvas);

  let ready = false;
  const cp = createClusterPoints(canvas, model, {
    forceWebGL: opts.forceWebGL ?? false,
    drifting: false, // the camera must not move: drift is time-dependent and would not pin
    onReady: () => {
      ready = true;
    },
  });

  for (let i = 0; i < 80 && !ready; i++) await sleep(100);

  /* Framing is set EXPLICITLY rather than inherited. `maxRPc` is derived from the model, but the
     default zoom is a UI concern that may legitimately change, and a baseline that moves when a
     default is retuned would report a regression that is not one. */
  cp.setZoom(1);
  cp.setFraming({ centre: [0, 0, 0], radiusPc: BASELINE_RADIUS_PC });
  if (caseId === "trail") cp.setTrail(baselineTrail(), [0.9, 0.5, 0.2]);
  if (caseId === "alpha") cp.setAlpha(baselineAlpha());

  /* Twice, with a settle between: the first presents the state change, the second guarantees the
     buffer being composited is the one that includes it. */
  cp.redraw();
  await sleep(400);
  cp.redraw();
  await sleep(400);

  const scratch = document.createElement("canvas");
  scratch.width = BASELINE_SIZE;
  scratch.height = BASELINE_SIZE;
  const g = scratch.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("clusterPointsBaseline: no 2-D context for readback");
  g.drawImage(canvas, 0, 0);
  const data = g.getImageData(0, 0, BASELINE_SIZE, BASELINE_SIZE).data;

  const cell = BASELINE_SIZE / BASELINE_GRID;
  const grid = new Float64Array(BASELINE_GRID * BASELINE_GRID);
  let sum = 0;
  let litPixels = 0;
  for (let y = 0; y < BASELINE_SIZE; y++) {
    for (let x = 0; x < BASELINE_SIZE; x++) {
      const i = (y * BASELINE_SIZE + x) * 4;
      const v = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      grid[((y / cell) | 0) * BASELINE_GRID + ((x / cell) | 0)]! += v;
      sum += v;
      if (v > 0) litPixels++;
    }
  }
  for (let i = 0; i < grid.length; i++) grid[i]! /= cell * cell;

  const shot: BaselineShot = {
    backend: cp.backend,
    sum,
    litPixels,
    grid: Array.from(grid, (v) => Number(v.toFixed(6))),
    ready,
    frames: cp.frames,
  };
  cp.dispose();
  canvas.remove();
  return shot;
}

/** Every case on one backend, in fixture order. */
export async function captureAll(opts: { forceWebGL?: boolean } = {}): Promise<
  Record<BaselineCaseId, BaselineShot>
> {
  const out = {} as Record<BaselineCaseId, BaselineShot>;
  for (const c of BASELINE_CASES) out[c.id] = await captureBaseline(c.id, opts);
  return out;
}
