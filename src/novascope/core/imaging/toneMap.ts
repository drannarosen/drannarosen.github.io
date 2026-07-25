/*
 * toneMap.ts — the CPU mirror of three's tone mapping operators (Layer 0, pure).
 *
 * WHY THIS EXISTS AT ALL, given three already ships them. Three reasons, and the first is the
 * one that forced it:
 *
 *   1. A renderer must know THE FAINTEST SCENE VALUE A CURVE CAN STILL SHOW, because that is
 *      what decides how far a star's billboard has to reach. `stretchInverse` answers it for the
 *      astropy curves and `luptonIntensityForOutput` for Lupton; without an equivalent here the
 *      photographic transfers would need a guessed floor. The floors are not close: measured
 *      below, AgX shows down to 1.9e-4 of white and Cineon cuts off hard at 4.0e-3 — a factor of
 *      21 — so one shared constant would either clip AgX's faint wings into visible square
 *      edges or waste twenty times the fill rate under Cineon.
 *   2. The CPU reference rasteriser (`viz/starfield/reference`) has to apply the SAME transfer
 *      the GPU applies, or the parity check compares two different images. That mistake has
 *      already been made once in this project and reported as a 90% error.
 *   3. Measurement. Hue spread, blue fraction and black-sky fraction are all computed on the
 *      CPU reference, so a transfer that only exists in TSL cannot be measured at all.
 *
 * TRANSCRIBED FROM A FILE ON DISK, not from memory: three r185.1's
 * `src/nodes/display/ToneMappingFunctions.js`, cross-read against the WebGL chunk
 * `src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js`. Same obligation as
 * `viz/starfield/luptonNode` carries in the other direction — change three's version and this
 * must follow — and the GPU-versus-CPU parity harness is what fails loudly if it doesn't.
 *
 * ── THE TRANSPOSE TRAP, and why the row sums below are a gate rather than a comment ──
 *
 * TSL's `mat3()` uses TWO DIFFERENT CONVENTIONS depending on its arguments, and three's own
 * source relies on both within one file:
 *
 *   - `mat3(a,b,c, d,e,f, g,h,i)` with nine plain NUMBERS constructs a `THREE.Matrix3`, whose
 *     constructor is documented ROW-major. This is how ACES is written.
 *   - `mat3(vec3, vec3, vec3)` with node arguments emits GLSL/WGSL `mat3(c0,c1,c2)`, which is
 *     COLUMN-major. This is how AgX is written, matching the GLSL chunk's layout — which carries
 *     the comment "transposed from source" for exactly this reason.
 *
 * Transcribing one with the other's convention transposes a colour matrix, which produces a
 * plausible image with wrong hues — the failure mode this repository keeps having to design
 * against. So the convention is not asserted here, it is DERIVED: every one of these matrices
 * maps neutral to neutral, so its ROWS must sum to 1. Read the correct way round they do, to
 * five decimals; read the wrong way round ACES's first row sums to 0.7016 and AgX's to 1.1058.
 * `check:tonemap` asserts the row sums, so a transposed transcription fails the build instead
 * of shipping.
 */
import { linearToSrgb } from "../colorimetry/index.ts";
import { ONE_DISPLAY_LEVEL } from "./lupton.ts";

/**
 * The tone mapping operators three r185.1 ships, in the order a UI should offer them.
 *
 * `srgb` is three's `LinearToneMapping` — a clamp and nothing else. It is included precisely
 * BECAUSE it is not a curve: it isolates what the sRGB encode alone does, so the difference
 * between it and `linear` (the astropy stretch, which is display-referred and gets no encode)
 * is a direct readout of the output transform. Naming it `linear` too would have collided with
 * that stretch and hidden the one comparison it is good for.
 */
export const TONE_MAP_IDS = ["agx", "neutral", "aces", "reinhard", "cineon", "srgb"] as const;
export type ToneMapId = (typeof TONE_MAP_IDS)[number];

type RGB = [number, number, number];

/** Apply a row-major 3x3 to a colour. Rows are written as they are read. */
function mul3(m: readonly [RGB, RGB, RGB], c: RGB): RGB {
  return [
    m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2],
    m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2],
    m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2],
  ];
}

/*
 * Every matrix below is stored ROW-MAJOR here regardless of how three writes it, so `mul3` has
 * one convention and the row sums are readable down the page. Where three used the column form
 * (AgX and the Rec.2020 pair) the transcription is transposed on the way in — which is the whole
 * subtlety, and is why `TONE_MAP_MATRICES` is exported for the gate to check rather than kept
 * private.
 */

/** sRGB -> AP1, ACES. Three writes this row-major already (nine scalars). */
const ACES_INPUT: readonly [RGB, RGB, RGB] = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];

/** AP1 -> sRGB, ACES. Rows sum to ~1 for the same reason. */
const ACES_OUTPUT: readonly [RGB, RGB, RGB] = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

/** Linear sRGB -> linear Rec.2020. Three writes this as COLUMNS; transposed here. */
const SRGB_TO_REC2020: readonly [RGB, RGB, RGB] = [
  [0.6274, 0.3293, 0.0433],
  [0.0691, 0.9195, 0.0113],
  [0.0164, 0.088, 0.8956],
];

/** Linear Rec.2020 -> linear sRGB. Three writes this as COLUMNS; transposed here. */
const REC2020_TO_SRGB: readonly [RGB, RGB, RGB] = [
  [1.6605, -0.5876, -0.0728],
  [-0.1246, 1.1329, -0.0083],
  [-0.0182, -0.1006, 1.1187],
];

/** AgX inset. Three writes this as COLUMNS; transposed here. */
const AGX_INSET: readonly [RGB, RGB, RGB] = [
  [0.856627153315983, 0.0951212405381588, 0.0482516061458583],
  [0.137318972929847, 0.761241990602591, 0.101439036467562],
  [0.11189821299995, 0.0767994186031903, 0.811302368396859],
];

/** AgX outset. Three writes this as COLUMNS; transposed here. */
const AGX_OUTSET: readonly [RGB, RGB, RGB] = [
  [1.1271005818144368, -0.11060664309660323, -0.016493938717834573],
  [-0.1413297634984383, 1.157823702216272, -0.016493938717834257],
  [-0.14132976349843826, -0.11060664309660294, 1.2519364065950405],
];

/**
 * The matrices, exposed so the gate can check the invariant that settles their orientation.
 *
 * ALL SIX map neutral to neutral, so every one has rows summing to 1 — including AgX's outset,
 * which is measured neutral to 1e-15 despite being the explicit inverse of Filament's matrix
 * rather than a colour-space rotation.
 *
 * `quotedDecimals` is how many decimal places THREE writes each constant to, which is a fact
 * about its source rather than a tolerance chosen here. It is what the gate derives its
 * tolerance from, and the distinction matters: read correctly, these rows sum to 1 to within
 * three's own rounding (0 for ACES input, 1.0e-5 for ACES output, 1.0e-4 for the Rec.2020 pair,
 * 1e-15 for both AgX matrices) — so a residual is inherited, not introduced. Read transposed,
 * they are off by ~0.3, which is three thousand times larger. A gate pinned to the quoted
 * precision therefore separates the two cleanly, and `check:transfers` proves it does by
 * transposing each matrix and asserting the check FAILS.
 */
export const TONE_MAP_MATRICES: ReadonlyArray<{
  name: string;
  rows: readonly [RGB, RGB, RGB];
  quotedDecimals: number;
}> = [
  { name: "ACES_INPUT", rows: ACES_INPUT, quotedDecimals: 5 },
  { name: "ACES_OUTPUT", rows: ACES_OUTPUT, quotedDecimals: 5 },
  { name: "SRGB_TO_REC2020", rows: SRGB_TO_REC2020, quotedDecimals: 4 },
  { name: "REC2020_TO_SRGB", rows: REC2020_TO_SRGB, quotedDecimals: 4 },
  { name: "AGX_INSET", rows: AGX_INSET, quotedDecimals: 15 },
  { name: "AGX_OUTSET", rows: AGX_OUTSET, quotedDecimals: 16 },
];

/**
 * The neutrality a caller may rely on, per operator — MEASURED, not assumed.
 *
 * AgX passes a colour through the Rec.2020 pair, which three quotes to four decimals, so its
 * grey response carries ~2e-4 of channel spread; ACES carries ~1e-5 from its five-decimal output
 * matrix; the other four are exact. All of these are far below one 8-bit display level
 * (3.9e-3), so `toneMapGrey` taking channel 0 is safe — but the number is stated rather than
 * hand-waved, because "close enough" is how a real error hides.
 */
export const TONE_MAP_NEUTRALITY_TOLERANCE = 5e-4;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampRGB = (c: RGB): RGB => [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];

/** ACES RRT+ODT fit, per channel. Three applies it componentwise. */
function rrtAndOdtFit(v: number): number {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

/** AgX's sigmoid, a 6th-order polynomial fit to the reference curve (mean error^2 3.67e-6). */
function agxContrast(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return (
    15.5 * x4 * x2 -
    40.14 * x4 * x +
    31.96 * x4 -
    6.868 * x2 * x +
    0.4298 * x2 +
    0.1191 * x -
    0.00232
  );
}

const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;

/**
 * Apply a tone mapping operator to a linear-sRGB colour.
 *
 * INPUT IS SCENE-REFERRED, OUTPUT IS DISPLAY-LINEAR — not display-encoded. Every one of these
 * ends in linear sRGB, which is why three follows `toneMapping()` with the output colour
 * transform in `RenderOutputNode`. The sRGB encode is applied separately by `toneMapDisplay`
 * below, kept apart on purpose: fusing them would hide the single most consequential fact about
 * this family, which is that they need an encode and the astronomical curves do not.
 */
export function toneMapRGB(color: RGB, id: ToneMapId, exposure = 1): RGB {
  switch (id) {
    case "srgb": {
      // three's LinearToneMapping: exposure and a clamp, no curve at all.
      return clampRGB([color[0] * exposure, color[1] * exposure, color[2] * exposure]);
    }
    case "reinhard": {
      const c: RGB = [color[0] * exposure, color[1] * exposure, color[2] * exposure];
      return clampRGB([c[0] / (c[0] + 1), c[1] / (c[1] + 1), c[2] / (c[2] + 1)]);
    }
    case "cineon": {
      // Hejl-Burgess-Dawson. Note the 0.004 SUBTRACTION: everything below that scene value is
      // exactly black, which is what makes this the shallowest floor of the six.
      const f = (v0: number): number => {
        const v = Math.max(0, v0 * exposure - 0.004);
        const a = v * (6.2 * v + 0.5);
        const b = v * (6.2 * v + 1.7) + 0.06;
        return (a / b) ** 2.2;
      };
      return [f(color[0]), f(color[1]), f(color[2])];
    }
    case "aces": {
      const e = exposure / 0.6;
      const inAp1 = mul3(ACES_INPUT, [color[0] * e, color[1] * e, color[2] * e]);
      const fit: RGB = [rrtAndOdtFit(inAp1[0]), rrtAndOdtFit(inAp1[1]), rrtAndOdtFit(inAp1[2])];
      return clampRGB(mul3(ACES_OUTPUT, fit));
    }
    case "agx": {
      const scaled: RGB = [color[0] * exposure, color[1] * exposure, color[2] * exposure];
      const rec = mul3(SRGB_TO_REC2020, scaled);
      const inset = mul3(AGX_INSET, rec);
      // Log2 encode, normalised onto [0,1] across AgX's exposure window, then the sigmoid.
      // Written out per channel rather than mapped, so the tuple type is inferred rather than
      // asserted — `.map()` on a 3-tuple widens to `number[]` and needs a cast to come back.
      const enc = (v: number): number =>
        clamp01((Math.log2(Math.max(v, 1e-10)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV));
      const sig: RGB = [
        agxContrast(enc(inset[0])),
        agxContrast(enc(inset[1])),
        agxContrast(enc(inset[2])),
      ];
      const out = mul3(AGX_OUTSET, sig);
      // 2.2 power, then back to linear sRGB. NOT an sRGB encode despite the exponent — it is
      // AgX's own display gamma, undone conceptually by the encode that follows.
      const gamma: RGB = [
        Math.max(0, out[0]) ** 2.2,
        Math.max(0, out[1]) ** 2.2,
        Math.max(0, out[2]) ** 2.2,
      ];
      return clampRGB(mul3(REC2020_TO_SRGB, gamma));
    }
    case "neutral": {
      // Khronos PBR Neutral, via three. Compresses only the peak channel and desaturates as it
      // does, which is why it holds hue far better than a per-channel curve — the same instinct
      // as Lupton's common-mode scaling, arrived at from the product-photography side.
      const START = 0.8 - 0.04;
      const DESAT = 0.15;
      const c: RGB = [color[0] * exposure, color[1] * exposure, color[2] * exposure];
      const x = Math.min(c[0], c[1], c[2]);
      const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      const o: RGB = [c[0] - offset, c[1] - offset, c[2] - offset];
      const peak = Math.max(o[0], o[1], o[2]);
      if (peak < START) return o;
      const d = 1 - START;
      const newPeak = 1 - (d * d) / (peak + (d - START));
      const s: RGB = [(o[0] * newPeak) / peak, (o[1] * newPeak) / peak, (o[2] * newPeak) / peak];
      const g = 1 - 1 / (DESAT * (peak - newPeak) + 1);
      return [
        s[0] + (newPeak - s[0]) * g,
        s[1] + (newPeak - s[1]) * g,
        s[2] + (newPeak - s[2]) * g,
      ];
    }
  }
}

/**
 * A tone mapper followed by the sRGB encode — what actually reaches the framebuffer.
 *
 * This composition IS the thing that distinguishes the photographic family from the
 * astronomical one, and it is the mistake that has to be avoided in both directions. Applying
 * the encode to Lupton (whose output is already display-referred, which is why astropy writes
 * it straight to a PNG) washes the image out. Omitting it here leaves a scene-linear image on
 * screen, which crushes the midtones and looks like an under-exposure.
 */
export function toneMapDisplay(color: RGB, id: ToneMapId, exposure = 1): RGB {
  const t = toneMapRGB(color, id, exposure);
  return [linearToSrgb(t[0]), linearToSrgb(t[1]), linearToSrgb(t[2])];
}

/**
 * The DISPLAY-referred response to a neutral input — a tone mapper reduced to one scalar curve.
 *
 * Well-defined because every operator here maps grey to grey, which is the same invariant that
 * settles the matrix orientations above. `check:tonemap` asserts it holds to 1e-6 rather than
 * assuming it, since a transposed matrix breaks neutrality first and most visibly.
 */
export function toneMapGrey(x: number, id: ToneMapId, exposure = 1): number {
  return toneMapDisplay([x, x, x], id, exposure)[0];
}

/*
 * Bisection bracket for the inverse. The lower end is below every operator's own cutoff (AgX's
 * hard floor is 2^-12.474 = 1.7e-4 of middle grey and Cineon's is 4e-3), and the upper end is
 * far above white, so the bracket cannot be the answer.
 */
const X_MIN = 1e-9;
const X_MAX = 1e4;

/**
 * The scene-linear grey whose displayed value is `target` — the inverse of `toneMapGrey`.
 *
 * BISECTED, not solved: AgX composes a log2, a 6th-order polynomial and two matrices, and
 * Cineon is a rational function raised to 2.2. None inverts in closed form, and a fitted inverse
 * would be a second approximation to keep true.
 *
 * Bisection is safe here only because each curve is monotonic in a neutral input, which
 * `check:tonemap` verifies BEFORE anything relies on it — the same precaution `luptonQForDepth`
 * and `massForMagnitudeLimit` carry, and for the recorded reason: a bisection on a
 * non-monotonic function returns a confident wrong answer.
 *
 * Clamped to the bracket rather than throwing. Below an operator's own cutoff no scene value
 * produces the requested output at all — Cineon genuinely cannot show anything under 4e-3 of
 * white — so the honest answer is the cutoff, not a failure.
 */
export function toneMapInverseGrey(target: number, id: ToneMapId, exposure = 1): number {
  if (!(target > 0)) return 0;
  if (toneMapGrey(X_MAX, id, exposure) <= target) return X_MAX;
  let lo = Math.log(X_MIN);
  let hi = Math.log(X_MAX);
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (toneMapGrey(Math.exp(mid), id, exposure) < target) lo = mid;
    else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}

/**
 * The scene value, relative to white, that a tone mapper still renders as one 8-bit level.
 *
 * The photographic family's answer to `stretchInverse(ONE_DISPLAY_LEVEL, id)` and
 * `luptonIntensityForOutput(ONE_DISPLAY_LEVEL, ...)`, in the same units and for the same
 * purpose: it sizes a star's billboard. Measured, and the spread is why it could not be a
 * constant — see the module header.
 */
export function toneMapFloor(id: ToneMapId, exposure = 1): number {
  return toneMapInverseGrey(ONE_DISPLAY_LEVEL, id, exposure);
}

/**
 * Monotonicity in a neutral input. Required of every operator here, because a display transfer
 * that is not monotonic reorders brightnesses — a star could read fainter than a fainter star.
 *
 * Sampled geometrically rather than uniformly: these curves do their work across decades, and a
 * uniform sweep over [0, 4] would put almost every sample on the flat shoulder and miss a toe
 * inversion entirely.
 */
export function isToneMapMonotonic(id: ToneMapId, samples = 4000): boolean {
  let prev = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const x = X_MIN * (X_MAX / X_MIN) ** (i / samples);
    const v = toneMapGrey(x, id);
    if (!(v >= prev - 1e-12)) return false;
    prev = v;
  }
  return true;
}

/** One-line description of what each operator does to a star field, for a UI to show. */
export const TONE_MAP_NOTES: Record<ToneMapId, string> = {
  agx: "Filmic, and the most aggressive shoulder here — a log-domain sigmoid across 16.5 stops. Desaturates as it compresses, so a saturated core drifts toward white; that is a deliberate film-like behaviour and it is the opposite of what Lupton is for.",
  neutral:
    "Khronos PBR Neutral. Compresses only the PEAK channel and desaturates in proportion, so hue survives much further than a per-channel curve — the same instinct as Lupton's common-mode scaling, reached from product photography rather than from astronomy.",
  aces: "The film-industry standard. Strong contrast, punchy midtones, and a noticeable hue shift in saturated highlights (the well-known ACES blue-to-magenta skew) — which on a cluster dominated by hot stars is precisely the wrong skew.",
  reinhard:
    "x/(1+x), applied per channel. The simplest possible shoulder: nothing ever clips, but nothing ever reaches white either, so the image reads flat and hazy.",
  cineon:
    "Hejl-Burgess-Dawson, a fit to a Cineon print stock. Subtracts 0.004 before the curve, so it CUTS OFF the faint end hard — the deepest black of the six, and the shallowest depth.",
  srgb: "Clamp, then encode. Not a curve at all — it isolates what the sRGB output transform alone does, so comparing it with the astropy `linear` stretch (which gets no encode) measures the encode by itself.",
};
