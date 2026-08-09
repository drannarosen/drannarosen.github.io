/*
 * volumeParity.ts — the TSL raymarch against its TypeScript reference (dev-only, Layer 2).
 *
 * ── WHAT IT COMPARES, AND WHY NOT THE OTHER SHADER ──
 *
 * The obvious check is "does the port match the WebGL 2 raymarch it replaces". It was rejected
 * twice over.
 *
 * First, the two no longer share a projection: the port is orthographic by decision and the
 * shipped shader is perspective, so a pixel comparison would be measuring the projection change,
 * which is the one difference we already know about and want. Making the old shader orthographic
 * would mean editing a shader that renders three live pages plus two lab surfaces, and whose
 * source is pinned byte-for-byte precisely so it is not edited casually.
 *
 * Second, and more important: two GPU implementations agreeing proves they agree, not that either
 * is right. ADR 0015's condition is a CPU reference — `core/transfer/volume.ts` — whose arithmetic
 * is tested against the analytic slab in node. Comparing against that checks the port against
 * mathematics, and it is the same shape as `check-parity` for the starfield.
 *
 * ── OVER BLACK, SO PREMULTIPLICATION CANCELS ──
 *
 * The march accumulates premultiplied colour. Composited over an opaque BLACK background,
 * premultiplied blending gives exactly `acc` — the reference's own output, with no un-premultiply
 * step and no alpha bookkeeping to get wrong. That is why the readback background is black and not
 * the page's dark blue: it makes the comparison an identity rather than a conversion.
 *
 * ── THE JITTER IS OFF ON BOTH ──
 *
 * The GPU dithers its ray start so 112 steps do not band. Two implementations cannot agree on a
 * hash, so `parityMode` zeroes it and the reference starts every ray at t0. Without that, this
 * would be comparing noise and would need a tolerance loose enough to hide a real defect.
 */
import { createSceneHost } from "../sceneHost.ts";
import { createVolumeLayer, VOLUME_STEPS, expansionFactor } from "../volumeLayer.ts";
import {
  compositeRay,
  expansionShift,
  massLossShift,
  type RayStep,
} from "../../core/transfer/volume.ts";

/** Framing fraction `sceneHost` applies; mirrored here so the CPU rays match the GPU camera. */
const FRAME_FILL = 0.92;
/**
 * Camera half-extent in OBJECT units — the single number both halves frame by.
 *
 * Wider than the box's own 0.5 on purpose, so the comparison includes empty margin. Two renderers
 * agreeing about where the cloud is is worth less if they were never asked to agree about where it
 * ISN'T; a stray ray-box intersection, an off-by-one in the slab test or a wrapped texture lookup
 * all show up first in the margin.
 *
 * `sceneHost` computes `half = maxR / FRAME_FILL`, so the driver passes
 * `radiusPc = FRAME_HALF_OBJ * boxPc * FRAME_FILL` to land here. Deriving it in one place is the
 * point: the first version of this file used 0.5/FRAME_FILL on the CPU against 0.5 on the GPU, a
 * 9% framing difference that would have read as a diffuse disagreement everywhere.
 */
const FRAME_HALF_OBJ = 0.6;

export interface ParityParams {
  floor: number;
  gamma: number;
  emit: number;
  absorb: number;
  /** Homologous expansion phase [0,1]. */
  expel: number;
  /** Gas mass remaining [0,1], at fixed radial shape. */
  gasFrac: number;
}

/**
 * Deliberately BRIGHTER than the page ships.
 *
 * The readback is 8-bit. At the page's own emission the cloud peaks around 65 of 255 and most of
 * its area sits within a level or two of black, so a comparison there is dominated by quantisation
 * rather than by the shader — measured, before this was raised: medians of 0.06-0.25 levels
 * (excellent agreement) beside energy ratios of 0.25-0.73, purely because the reference's diffuse
 * tail rounds to zero on the GPU.
 *
 * Exposing the cloud across the range is what makes the comparison about the arithmetic. It is a
 * test fixture, not a display setting, and it asserts nothing about how the page should look.
 *
 * Not brighter still: at emit 6 the core SATURATES, and a saturated pixel agrees trivially while
 * the reference goes on accumulating past 1. That is what `clampDisplay` below exists for, and
 * this value keeps the comparison in the regime where both sides can actually disagree.
 */
export const DEFAULT_PARAMS: ParityParams = {
  floor: 0.15,
  gamma: 1,
  emit: 3,
  absorb: 2.2,
  expel: 0,
  gasFrac: 1,
};

/**
 * One 8-bit level, doubled. Channels dimmer than this on BOTH sides are excluded from the energy
 * comparison, because the GPU cannot represent them and their disagreement is arithmetic the
 * readback threw away rather than arithmetic the shader got wrong.
 */
const QUANT_FLOOR = 2 / 255;

/** The displayable range. The GPU clips here; a reference compared against it must too. */
const clampDisplay = (v: number): number => (v > 1 ? 1 : v < 0 ? 0 : v);

/**
 * Trilinear sample of the cube with clamp-to-edge, matching `LinearFilter` + `ClampToEdgeWrapping`.
 *
 * The texel centre convention is the load-bearing part: a texture coordinate of 0 addresses the
 * CENTRE of texel 0, so the texel-space coordinate is `u * n - 0.5`. Getting that wrong shifts the
 * whole field by half a voxel — invisible on a smooth cloud and a systematic error everywhere.
 */
export function sampleTrilinear(
  vol: Uint8Array,
  n: number,
  x: number,
  y: number,
  z: number,
): number {
  const tx = x * n - 0.5;
  const ty = y * n - 0.5;
  const tz = z * n - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const z0 = Math.floor(tz);
  const fx = tx - x0;
  const fy = ty - y0;
  const fz = tz - z0;
  const c = (v: number): number => Math.min(n - 1, Math.max(0, v));
  const at = (i: number, j: number, k: number): number =>
    vol[c(k) * n * n + c(j) * n + c(i)]! / 255;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const x00 = lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), fx);
  const x10 = lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), fx);
  const x01 = lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), fx);
  const x11 = lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

export interface ParityImage {
  /** N*N*3 premultiplied RGB, row-major from the TOP-LEFT — canvas order, both sides. */
  rgb: Float64Array;
  n: number;
}

/**
 * Render the reference image on the CPU.
 *
 * Orthographic: every ray is (0,0,-1) in object space with the camera unrotated, so the entry and
 * exit points are the box's z faces and the path length is exactly 1 in object units. That is why
 * this can be written without a general slab test — and why the GPU side keeps one, since it must
 * also work under the pivot's rotation.
 */
export function cpuRender(
  vol: Uint8Array,
  ngrid: number,
  logRange: number,
  n: number,
  params: ParityParams,
): ParityImage {
  const S = expansionFactor(params.expel);
  const dilute = expansionShift(S, logRange);
  const massDilute = massLossShift(params.gasFrac, logRange);
  const half = FRAME_HALF_OBJ;
  const out = new Float64Array(n * n * 3);
  const steps: RayStep[] = new Array(VOLUME_STEPS);
  const dt = 1 / VOLUME_STEPS; // path length through a unit box along z, divided by the step count

  for (let j = 0; j < n; j++) {
    /* +y is UP in the camera, and row 0 of an image is the TOP, so y flips. */
    const oy = (1 - ((j + 0.5) / n) * 2) * half;
    for (let i = 0; i < n; i++) {
      const ox = (((i + 0.5) / n) * 2 - 1) * half;
      if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) continue; // ray misses the box entirely
      for (let k = 0; k < VOLUME_STEPS; k++) {
        /* Entry at z = +0.5 marching to -0.5, sampled at the step's start, as the GPU does with
           the jitter zeroed. */
        const oz = 0.5 - (k + 0) * dt;
        const sx = 0.5 + (ox - 0) / S;
        const sy = 0.5 + (oy - 0) / S;
        const sz = 0.5 + (oz - 0) / S;
        const d = sampleTrilinear(vol, ngrid, sx, sy, sz) - dilute - massDilute;
        steps[k] = { d, dt };
      }
      const r = compositeRay(steps, {
        floor: params.floor,
        gamma: params.gamma,
        absorb: params.absorb,
        emit: params.emit,
      });
      const o = (j * n + i) * 3;
      out[o] = r.rgb[0];
      out[o + 1] = r.rgb[1];
      out[o + 2] = r.rgb[2];
    }
  }
  return { rgb: out, n };
}

/**
 * Render the same thing through the TSL layer and read it back over BLACK.
 *
 * `forceWebGL` is honoured so the gate can drive both backends, and the backend actually obtained
 * is returned rather than assumed — the lesson `check-cluster-points` learned when a run reported
 * two backends while exercising one.
 */
export async function gpuRender(
  vol: Uint8Array,
  ngrid: number,
  boxPc: number,
  logRange: number,
  n: number,
  params: ParityParams,
  opts: { forceWebGL?: boolean } = {},
): Promise<{ image: ParityImage; backend: "webgpu" | "webgl2"; ready: boolean; buffer: { w: number; h: number } }> {
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  canvas.style.width = `${n}px`;
  canvas.style.height = `${n}px`;
  canvas.style.position = "fixed";
  canvas.style.left = "-9999px";
  document.body.appendChild(canvas);

  let ready = false;
  const host = createSceneHost(canvas, {
    forceWebGL: opts.forceWebGL ?? false,
    onReady: () => {
      ready = true;
    },
  });
  const layer = createVolumeLayer(
    { volume: vol, ngrid, logRange },
    { floor: params.floor, gamma: params.gamma, emit: params.emit, absorb: params.absorb, parityMode: true },
  );
  layer.mesh.scale.setScalar(boxPc);
  host.pivot.add(layer.mesh);
  /* Inverts sceneHost's `half = maxR / FRAME_FILL` so the camera half-extent lands on
     FRAME_HALF_OBJ in object units — the same number the CPU side frames by. */
  host.setFraming({ centre: [0, 0, 0], radiusPc: FRAME_HALF_OBJ * boxPc * FRAME_FILL });
  host.start();
  for (let i = 0; i < 100 && !ready; i++) await new Promise((r) => setTimeout(r, 100));

  layer.setExpel(params.expel);
  layer.setGasFraction(params.gasFrac);
  host.redraw();
  await new Promise((r) => setTimeout(r, 500));
  host.redraw();
  await new Promise((r) => setTimeout(r, 500));

  const scratch = document.createElement("canvas");
  scratch.width = n;
  scratch.height = n;
  const g = scratch.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("volumeParity: no 2-D context");
  /* BLACK, so premultiplied compositing returns `acc` unchanged. ONE read: drawImage consumes a
     canvas without preserveDrawingBuffer, and a second read comes back empty — which reads as a
     dark render and has already cost one wrong conclusion in this work. */
  g.fillStyle = "#000";
  g.fillRect(0, 0, n, n);
  /*
   * SCALED to n x n, explicitly.
   *
   * `setPixelRatio(dpr)` means `renderer.setSize(n, n, false)` leaves `canvas.width` at n * dpr,
   * so a bare `drawImage(canvas, 0, 0)` draws at intrinsic size and the read returns the TOP-LEFT
   * QUADRANT — mostly empty margin. Measured before this was fixed: the GPU appeared to be zero
   * everywhere (mean 0.0001) while the same layer rendered 40,000 lit pixels in a standalone
   * probe, and the parity gate reported a plausible-looking 0.64 energy ratio rather than an
   * obvious failure.
   */
  g.drawImage(canvas, 0, 0, n, n);
  const data = g.getImageData(0, 0, n, n).data;

  const rgb = new Float64Array(n * n * 3);
  for (let p = 0; p < n * n; p++) {
    rgb[p * 3] = data[p * 4]! / 255;
    rgb[p * 3 + 1] = data[p * 4 + 1]! / 255;
    rgb[p * 3 + 2] = data[p * 4 + 2]! / 255;
  }

  const backend = host.backend;
  /* The drawing buffer's real size, so a future DPR change cannot silently reintroduce the
     quadrant bug above — the gate asserts this matches what it asked for. */
  const buffer = { w: canvas.width, h: canvas.height };
  layer.dispose();
  host.dispose();
  canvas.remove();
  return { image: { rgb, n }, backend, ready, buffer };
}

export interface ParityStats {
  /** Total light on each side, and their ratio. A dropped term moves this at once. */
  cpuEnergy: number;
  gpuEnergy: number;
  /** Share of the reference's light too dim for an 8-bit readback. Reported, never hidden. */
  excludedFraction: number;
  energyRatio: number;
  /** Median and p99 absolute difference in 8-bit display levels, over LIT pixels only. */
  p50Levels: number;
  p99Levels: number;
  maxLevels: number;
  /** Pixels actually compared. Guards the vacuous pass: two black frames agree perfectly. */
  compared: number;
}

/**
 * Compare, in 8-bit display levels, over pixels either side considers lit.
 *
 * Levels rather than a relative error because the GPU readback is quantised to 8 bits: a relative
 * comparison on a pixel worth 1/255 is dominated by the quantisation and reports a healthy
 * renderer as broken, which is the tail `check-parity` documents at length. A level is also the
 * unit that means something — one is the smallest step anyone can see.
 */
export function compare(cpu: ParityImage, gpu: ParityImage): ParityStats {
  const n = cpu.n;
  const diffs: number[] = [];
  let cpuEnergy = 0;
  let gpuEnergy = 0;
  let excludedEnergy = 0;
  let maxLevels = 0;
  for (let p = 0; p < n * n; p++) {
    for (let c = 0; c < 3; c++) {
      /*
       * CLAMPED, because the readback physically cannot exceed 1 and an unclamped reference is
       * being compared against something unrepresentable.
       *
       * This was measured the wrong way round first: raising `emit` to expose the cloud made the
       * energy ratio WORSE (0.725 -> 0.447), which is the opposite of a quantisation floor and the
       * signature of saturation. The reference was accumulating light the canvas had already
       * clipped.
       */
      const a = clampDisplay(cpu.rgb[p * 3 + c]!);
      const b = gpu.rgb[p * 3 + c]!;
      /* Energy over REPRESENTABLE channels only. Below one or two levels the GPU reads zero by
         construction, so including them would compare the shader against the readback's floor. The
         excluded share is reported rather than dropped silently. */
      if (a >= QUANT_FLOOR || b >= QUANT_FLOOR) {
        cpuEnergy += a;
        gpuEnergy += b;
      } else {
        excludedEnergy += a;
      }
      if (a <= 0 && b <= 0) continue;
      const d = Math.abs(a - b) * 255;
      diffs.push(d);
      if (d > maxLevels) maxLevels = d;
    }
  }
  diffs.sort((x, y) => x - y);
  const q = (f: number): number => (diffs.length ? diffs[Math.floor(f * (diffs.length - 1))]! : 0);
  return {
    cpuEnergy,
    gpuEnergy,
    excludedFraction: cpuEnergy + excludedEnergy > 0 ? excludedEnergy / (cpuEnergy + excludedEnergy) : 0,
    energyRatio: cpuEnergy > 0 ? gpuEnergy / cpuEnergy : 0,
    p50Levels: q(0.5),
    p99Levels: q(0.99),
    maxLevels,
    compared: diffs.length,
  };
}
