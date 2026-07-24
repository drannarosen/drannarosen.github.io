/*
 * check-star-optics.mjs — build gate for the pure star-optics module
 * (src/novascope/viz/starOptics.ts). This is the physics→pixel MATH for the
 * photographic star renderer: apparent flux, robust asinh exposure, Moffat PSF,
 * aureole, flux tiers, and linear blackbody chromaticity. It is dependency-free
 * (no three, no DOM) so node can type-strip and run it, and so it ports cleanly
 * to the raw-WebGL2 production renderer and later to TSL/WebGPU.
 *
 * The GLSL in the Three.js lab harness (src/lib/starlab/shaders.ts) MIRRORS
 * these functions; the constants live here, once, verified here.
 */
import {
  deriveLogL,
  apparentFlux,
  D0_PC,
  blackbodyLinearRGB,
  robustWhiteFlux,
  asinhResponse,
  DEFAULT_SOFTENING,
} from "../src/novascope/viz/starOptics.ts";
import { effectiveTemperature } from "../src/novascope/core/stellar/index.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("star-optics (novascope/viz):");

/* ── luminosity: derived from the CORE Stefan-Boltzmann relation, not a copy ── */
// Exact round-trip against core: the star with L=1,R=1 has logL exactly 0. This
// asserts starOptics uses core's relation rather than its own sigma_SB.
ok(deriveLogL(effectiveTemperature(1, 1), 1) === 0, "logL is core's Stefan-Boltzmann, exactly inverted");
// The IAU nominal 5772 K differs from core's CGS-derived anchor in the 6th
// decimal, so the Sun lands at logL = 0 to ~1e-6, not bitwise.
ok(Math.abs(deriveLogL(5772, 1)) < 1e-5, "Sun (5772 K, 1 Rsun) has logL = 0");
ok(Math.abs(deriveLogL(5772, 2) - 2 * Math.log10(2)) < 1e-5, "logL scales as R^2");
ok(Math.abs(deriveLogL(2 * 5772, 1) - 4 * Math.log10(2)) < 1e-5, "logL scales as Teff^4");

/* ── apparent flux: F = L / (4 pi d^2) ── */
const F1 = apparentFlux(0, D0_PC);
const F2 = apparentFlux(0, 2 * D0_PC);
ok(Math.abs(F2 / F1 - 0.25) < 1e-12, "flux falls as 1/d^2");
// Flux is linear in L: +1 dex of luminosity is 10x the flux at fixed distance.
ok(Math.abs(apparentFlux(1, D0_PC) / F1 - 10) < 1e-9, "flux is linear in luminosity");
ok(F1 > 0 && Number.isFinite(F1), "flux is finite and positive");
ok(D0_PC > 0, "the common cluster distance is positive");

/* ── chromaticity: linear-light, max-normalized, INDEPENDENT of flux ── */
const hot = blackbodyLinearRGB(30000);
const sun = blackbodyLinearRGB(5772);
const cool = blackbodyLinearRGB(3200);

// Flux separation: every colour is max-normalized to 1, so hue carries no
// brightness. A star's colour must not change when it gets brighter.
for (const [name, c] of [["30 kK", hot], ["5772 K", sun], ["3.2 kK", cool]]) {
  ok(Math.abs(Math.max(...c) - 1) < 1e-9, `${name} chroma is max-normalized (flux separated)`);
  ok(c.every((v) => v >= 0 && v <= 1 && Number.isFinite(v)), `${name} channels in [0,1] and finite`);
}

// Spec acceptance: hot stars blue-WHITE (not saturated blue), cool stars warm.
// "Appears white-ish" is a claim about the DISPLAYED colour, so it is asserted
// after the sRGB transfer, not on the linear values: linear 0.377 red encodes to
// 0.648: pale blue-white on screen. Asserting whiteness on linear light would
// wrongly condemn a correct colour (and is how a linear pipeline gets "fixed"
// into a gamma-encoded one).
const srgb = (c) => c.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
ok(hot[2] >= hot[0], "30 kK star is blue-white (blue >= red)");
ok(srgb(hot)[0] > 0.5, "…and reads white-ish on screen, not a saturated blue");
ok(cool[0] > cool[2], "3.2 kK star is warm (red > blue)");
ok(cool[2] > 0, "…but not pure red — a blackbody has blue in it");
// The Sun is near-white: no whole-cluster orange bias can originate here.
ok(srgb(sun).every((v) => v > 0.9), "the Sun is near-white (no orange bias at source)");

// The Planckian locus is monotone in colour: blue/red must rise with Teff.
const ratios = [2500, 4000, 6000, 10000, 20000, 40000].map((T) => {
  const c = blackbodyLinearRGB(T);
  return c[2] / c[0];
});
ok(
  ratios.every((v, i) => i === 0 || v > ratios[i - 1]),
  "blue/red ratio rises monotonically with Teff along the Planckian locus",
);

// Guards: the LUT is sampled at arbitrary Teff, so it must not blow up at the ends.
ok(blackbodyLinearRGB(1000).every(Number.isFinite), "finite below the fit range");
ok(blackbodyLinearRGB(60000).every(Number.isFinite), "finite above the fit range");

/* ── robust exposure: a percentile, NEVER the max ──
 * This is the fix for the giant central blob. Normalizing by the single
 * brightest star lets one O star set the scale for 10,301 stars, so everything
 * else collapses to black while that star's core saturates. */
const bulk = Array.from({ length: 1000 }, (_, i) => i); // 0..999
const withRunaway = [...bulk, 1e9]; // one pathologically bright star
const w = robustWhiteFlux(withRunaway, 0.995);
ok(w < 1000, "whiteFlux ignores the single runaway (it is not the max)");
ok(w > 980, "whiteFlux sits at the ~P99.5 of the bulk");
// Robustness is the point: adding an extreme outlier must barely move it.
ok(
  Math.abs(robustWhiteFlux(withRunaway, 0.995) - robustWhiteFlux(bulk, 0.995)) <= 2,
  "one runaway star barely moves the exposure",
);
ok(robustWhiteFlux([5], 0.995) === 5, "single-star population is well-defined");
ok(robustWhiteFlux([], 0.995) > 0, "empty population yields a safe positive white point");
// Unsorted input must give the same answer as sorted (no reliance on order).
ok(
  robustWhiteFlux([9, 1, 7, 3, 5], 0.5) === robustWhiteFlux([1, 3, 5, 7, 9], 0.5),
  "percentile is order-independent",
);

/* ── asinh photographic response ── */
const white = 100;
const K = DEFAULT_SOFTENING;
ok(Math.abs(asinhResponse(white, 1, K, white) - 1) < 1e-12, "signal = 1 at whiteFlux");
ok(asinhResponse(0, 1, K, white) === 0, "zero flux -> zero signal");
const half = asinhResponse(white / 2, 1, K, white);
const full = asinhResponse(white, 1, K, white);
ok(full > half && full < 2 * half, "monotone and compressive (asinh, not linear)");
// The acceptance criterion: faint stars must be VISIBLE, so cluster structure reads.
ok(asinhResponse(white * 0.01, 1, K, white) > 0.05, "a 1%-flux star is lifted into visibility");
ok(asinhResponse(white * 0.001, 1, K, white) > 0.01, "…and a 0.1%-flux star is still non-zero");
// Only genuinely brighter-than-white sources exceed 1 and clip into bloom.
ok(asinhResponse(white * 10, 1, K, white) > 1, "a 10x-white star exceeds 1 (clips, feeds bloom)");
ok(
  asinhResponse(white * 10, 1, K, white) < 2,
  "…but compressively — 10x the flux is far less than 10x the signal",
);
ok(asinhResponse(white, 2, K, white) > 1, "exposure raises the signal");

/* SCALE INVARIANCE — the regression test for a real bug.
 * k must be dimensionless, so scaling every flux by a constant (a different
 * D0_PC, or different luminosity units) must not change a single display value.
 * The obvious form asinh(k*F)/asinh(k*white) FAILS this: k then carries units of
 * 1/flux, which silently put the linear-regime threshold above white and left 98%
 * of the real cluster invisible. */
const SCALE = 1e-7;
ok(
  [0.001, 0.01, 0.5, 1, 10].every(
    (r) => Math.abs(asinhResponse(r * white, 1, K, white) - asinhResponse(r * white * SCALE, 1, K, white * SCALE)) < 1e-12,
  ),
  "response is scale-invariant (D0 and flux units cancel exactly)",
);
// Softening does what it claims: more k reveals more of the faint field...
ok(
  asinhResponse(white * 1e-4, 1, 1e5, white) > asinhResponse(white * 1e-4, 1, 1e2, white),
  "larger k lifts more faint stars into view",
);
// ...without changing what clips. Clipping is the exposure percentile's job alone.
ok(
  asinhResponse(white, 1, 1e5, white) === 1 && asinhResponse(white, 1, 1e2, white) === 1,
  "…while the white point stays fixed, so k and exposure stay orthogonal",
);

process.exit(failures ? 1 : 0);
