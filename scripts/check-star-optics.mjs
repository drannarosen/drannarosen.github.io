/*
 * check-star-optics.mjs — build gate for the physics→pixel path of the
 * photographic star renderer (ADR 0015).
 *
 * ONE gate over the modules that compose it, rather than four near-empty ones:
 *   core/photometry   apparent flux, distance modulus
 *   core/colorimetry  linear blackbody chromaticity, sRGB transfer
 *   core/optics       Moffat PSF, scattered-light aureole
 *   core/imaging      robust white point, asinh stretch
 *   viz/starfield     pixel core radius, render tiers
 *
 * Everything under core/ is dependency-free (no three, no DOM), so node can
 * type-strip and run it — which is precisely why the maths stays in TypeScript
 * while the GPU path mirrors it in TSL: a TSL node is a graph object with no CPU
 * value and cannot be asserted on here.
 */
import {
  deriveLogL,
  apparentFlux,
  D0_PC,
  distanceModulus,
  apparentMagnitude,
  absoluteMagnitude,
  magnitudeDifference,
  fluxRatioForMagnitudes,
  bolometricMagnitude,
} from "../src/novascope/core/photometry/index.ts";
import {
  blackbodyLinearRGB,
  linearToSrgbRGB,
  spectrumToXYZ,
  spectrumLinearRGB,
  unitLuminanceChroma,
  relativeLuminance,
} from "../src/novascope/core/colorimetry/index.ts";
import { planckNm, wienPeakLambda, NM_TO_CM } from "../src/novascope/core/blackbody/index.ts";
import { COLOR_SCHEMES, getScheme, stretchChroma } from "../src/novascope/core/colorimetry/schemes.ts";
import { PASSBANDS, bandFlux, bandIntegral, colorIndex, bandResponse, VEGA_TEFF_K, BAND_COMPOSITES } from "../src/novascope/core/photometry/passbands.ts";
import { moffat, aureole, DEFAULT_AUREOLE } from "../src/novascope/core/optics/index.ts";
import {
  robustWhiteFlux,
  asinhResponse,
  DEFAULT_SOFTENING,
  VISIBILITY_THRESHOLD,
  limitingFluxRatio,
  softeningForLimit,
} from "../src/novascope/core/imaging/index.ts";
import {
  computeTiers,
  quadExtentPx,
  aureoleExtentRadii,
  MAX_QUAD_PX,
  subpixelGain,
  PSF_WIDTH_PX,
  PSF_BETA,
  MIN_RENDERABLE_PX,
} from "../src/novascope/viz/starfield/sizing.ts";
import { prepareStarField, STAR_STRIDE } from "../src/novascope/viz/starfield/prepare.ts";
import { clusterStarTable } from "../src/novascope/viz/starfield/source.ts";
import { starProfile } from "../src/novascope/viz/starfield/profile.ts";
import { renderReference } from "../src/novascope/viz/starfield/reference.ts";
import { effectiveTemperature } from "../src/novascope/core/stellar/index.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("star-render physics (core/photometry · colorimetry · optics · imaging + viz/starfield):");

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

/* ── distance modulus / magnitudes ── */
ok(Math.abs(distanceModulus(10)) < 1e-12, "distance modulus is 0 at 10 pc, by definition");
ok(Math.abs(distanceModulus(100) - 5) < 1e-12, "…and 5 mag per decade of distance");
// A source 10x further is 5 mag fainter; the two conversions must invert exactly.
ok(Math.abs(apparentMagnitude(0, 100) - 5) < 1e-12, "apparent magnitude adds the modulus");
ok(
  Math.abs(absoluteMagnitude(apparentMagnitude(-3.2, 750), 750) - -3.2) < 1e-12,
  "apparent/absolute magnitude round-trip exactly",
);
/* Bolometric magnitudes, on the IAU 2015 B2 scale whose zero point is exact by
 * definition. The solar value is DERIVED from L_SUN_ERG_S and L_ZERO_BOL_ERG_S
 * rather than typed as 4.74 — the same treatment T_SUN_K gets — so this asserts
 * the derivation lands on the familiar number instead of trusting it. */
ok(Math.abs(bolometricMagnitude(0) - 4.74) < 0.005, "the Sun's M_bol derives to 4.74");
ok(Math.abs(bolometricMagnitude(1) - bolometricMagnitude(0) + 2.5) < 1e-12,
  "…and one dex of luminosity is exactly 2.5 mag");
ok(bolometricMagnitude(6) < bolometricMagnitude(0), "a more luminous star has a SMALLER magnitude");
/* Flux ratios and magnitude differences must invert, since the depth control
 * converts between them on every render. */
ok(Math.abs(magnitudeDifference(fluxRatioForMagnitudes(7.3)) - 7.3) < 1e-12,
  "magnitude difference and flux ratio invert exactly");
ok(Math.abs(magnitudeDifference(1)) < 1e-12, "a ratio of 1 is a difference of 0 mag");
ok(Math.abs(magnitudeDifference(0.01) - 5) < 1e-12, "…and a 100x ratio is 5 mag");
ok(magnitudeDifference(0) === Infinity, "zero flux is infinitely faint, not NaN");

/* ── the Planck function ── */
// Wien: the peak shifts as 1/T. The Sun peaks in the visible (~500 nm).
ok(Math.abs(wienPeakLambda(5772) / NM_TO_CM - 502) < 2, "Sun's Planck peak is ~502 nm (Wien)");
ok(
  Math.abs(wienPeakLambda(2886) / wienPeakLambda(5772) - 2) < 1e-9,
  "peak wavelength scales as 1/T",
);
// The peak really is a maximum of the sampled function, not just a formula.
const peakNm = wienPeakLambda(5772) / NM_TO_CM;
ok(
  planckNm(peakNm, 5772) > planckNm(peakNm * 0.8, 5772) &&
    planckNm(peakNm, 5772) > planckNm(peakNm * 1.2, 5772),
  "…and B_lambda is genuinely maximal there",
);
// A hotter body is brighter at EVERY wavelength (Planck curves never cross).
ok(
  [200, 500, 2000].every((l) => planckNm(l, 8000) > planckNm(l, 4000)),
  "Planck curves never cross — hotter is brighter at every wavelength",
);
ok(planckNm(500, 0) === 0 && planckNm(0, 5772) === 0, "degenerate inputs return 0, not NaN");

/* ── the CIE observer fit, validated two independent ways ──
 * The colour-matching functions are the Wyman, Sloan & Shirley (2013) analytic
 * fit rather than the tabulated 243 numbers, so they need real verification:
 * one mistyped coefficient would shift every colour on the site while still
 * looking plausible. */
const [Xe, Ye, Ze] = spectrumToXYZ(() => 1);
const sumE = Xe + Ye + Ze;
// 1. An equal-energy spectrum (illuminant E) sits at x = y = 1/3 BY DEFINITION.
ok(Math.abs(Xe / sumE - 1 / 3) < 2e-3, "equal-energy spectrum lands on the white point x = 1/3");
ok(Math.abs(Ye / sumE - 1 / 3) < 2e-3, "…and y = 1/3");
// 2. Integrated blackbody chromaticity agrees with the Kim et al. (2002)
//    Planckian locus, which was fitted to the real table by a different route.
const kimLocus = (T) => {
  const Tc = Math.min(25000, Math.max(1667, T));
  const t = 1 / Tc;
  const x =
    Tc < 4000
      ? -0.2661239e9 * t ** 3 - 0.2343589e6 * t ** 2 + 0.8776956e3 * t + 0.17991
      : -3.0258469e9 * t ** 3 + 2.1070379e6 * t ** 2 + 0.2226347e3 * t + 0.24039;
  const y =
    Tc < 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : Tc < 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
};
for (const T of [3000, 4000, 5772, 10000, 20000]) {
  const [X, Y, Z] = spectrumToXYZ((l) => planckNm(l, T));
  const sum = X + Y + Z;
  const [xk, yk] = kimLocus(T);
  ok(
    Math.abs(X / sum - xk) < 2e-3 && Math.abs(Y / sum - yk) < 2e-3,
    `integrated blackbody colour at ${T} K matches the Planckian locus`,
  );
}
// The general path and the blackbody convenience must be the SAME computation.
const viaGeneral = spectrumLinearRGB((l) => planckNm(l, 9000));
const viaBlackbody = blackbodyLinearRGB(9000);
ok(
  viaGeneral.every((v, i) => Math.abs(v - viaBlackbody[i]) < 1e-12),
  "blackbodyLinearRGB is the general spectrum path, not a second formula",
);

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
const srgb = linearToSrgbRGB;
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

/* ── passbands: what a FILTER sees, not the bolometric total ── */
const bU = PASSBANDS.U, bB = PASSBANDS.B, bV = PASSBANDS.V, bR = PASSBANDS.R;
const bI = PASSBANDS.I, bJ = PASSBANDS.J, bH = PASSBANDS.H, bK = PASSBANDS.K;
ok(Object.values(PASSBANDS).every((b) => b.lambdaEffNm > 0 && b.fwhmNm > 0), "every band is well-formed");
ok(bU.lambdaEffNm < bB.lambdaEffNm && bB.lambdaEffNm < bV.lambdaEffNm, "UBV are ordered in wavelength");
ok(bV.lambdaEffNm < bR.lambdaEffNm && bR.lambdaEffNm < bI.lambdaEffNm, "VRI are ordered");
ok(bI.lambdaEffNm < bJ.lambdaEffNm && bJ.lambdaEffNm < bH.lambdaEffNm && bH.lambdaEffNm < bK.lambdaEffNm, "IJHK are ordered");
ok(Math.abs(bandResponse(bV.lambdaEffNm, bV) - 1) < 1e-12, "band response peaks at 1 at lambda_eff");
ok(
  Math.abs(bandResponse(bV.lambdaEffNm + bV.fwhmNm / 2, bV) - 0.5) < 1e-6,
  "…and is at half power one half-FWHM away, by construction",
);

// The Vega convention: an A0V-like star has zero colour in every index.
ok(Math.abs(colorIndex(VEGA_TEFF_K, bB, bV)) < 1e-9, "A0V-like star has B-V = 0 (Vega zero point)");
ok(Math.abs(colorIndex(VEGA_TEFF_K, bV, bK)) < 1e-9, "…and V-K = 0");

// Colour indices must redden monotonically as stars cool.
const bvSeq = [30000, 15000, 9550, 6000, 4500, 3200].map((T) => colorIndex(T, bB, bV));
ok(
  bvSeq.every((v, i) => i === 0 || v > bvSeq[i - 1]),
  "B-V reddens monotonically from O to M",
);
ok(colorIndex(30000, bB, bV) < 0 && colorIndex(3200, bB, bV) > 1, "hot stars are blue (B-V<0), M stars red (B-V>1)");

/* Against REAL dwarf colours (Pecaut & Mamajek 2013). A blackbody is not a star:
 * line blanketing suppresses the blue, so real stars are REDDER than these
 * synthetic colours by a few tenths of a magnitude. The gate pins the sign and
 * the size of that known deficit, so the approximation stays honest and a future
 * empirical correction has something to beat. */
for (const [name, T, realBV] of [["Sun", 5772, 0.65], ["K5V", 4410, 1.15], ["M4V", 3200, 1.6]]) {
  const synth = colorIndex(T, bB, bV);
  ok(synth < realBV, `${name}: blackbody B-V is bluer than the real star, as expected`);
  ok(realBV - synth < 0.45, `${name}: …and the blackbody deficit stays under 0.45 mag`);
}

/* The bug this module fixes: bolometric flux over-brightens stars whose light
 * falls mostly OUTSIDE the band being viewed — cool stars (IR) and hot stars
 * (UV) alike. */
const vRel = (T, Rs) => bandFlux(T, Rs, 400, bV) / bandFlux(5772, 1, 400, bV);
const boloRel = (T, Rs) => (Rs * Rs * (T / 5772) ** 4) / 1;
ok(boloRel(3200, 0.3) / vRel(3200, 0.3) > 2, "a cool star is over-bright bolometrically vs in V");
ok(boloRel(20000, 5) / vRel(20000, 5) > 2, "…and so is a hot star, whose flux is largely UV");
// The inversion that makes an IR view worth having.
const coolVK = bandFlux(3200, 0.3, 400, bK) / bandFlux(3200, 0.3, 400, bV);
const hotVK = bandFlux(20000, 5, 400, bK) / bandFlux(20000, 5, 400, bV);
ok(coolVK > hotVK, "cool stars are relatively far brighter in K than in V — the point of an IR view");
ok(bandFlux(5772, 1, 400, bV) > bandFlux(5772, 1, 800, bV), "band flux falls with distance");
ok(bandFlux(0, 1, 400, bV) === 0 && bandFlux(5772, 0, 400, bV) === 0, "degenerate inputs give 0");
ok(bandIntegral(() => 0, bV) === 0, "a null spectrum integrates to zero");
ok(
  BAND_COMPOSITES.every((c) => c.bands.length === 3 && c.note.length > 0),
  "every composite names three bands and carries a caption",
);
// A composite must be ordered red -> blue in wavelength, or the mapping lies.
ok(
  BAND_COMPOSITES.every((c) => c.bands[0].lambdaEffNm > c.bands[2].lambdaEffNm),
  "…and maps the longest wavelength to red, the shortest to blue",
);

/* ── colour schemes: one physics, several honest presentations ── */
const chromaDistance = (c) => {
  const lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  return Math.hypot(c[0] - lum, c[1] - lum, c[2] - lum);
};
for (const s of COLOR_SCHEMES) {
  const samples = [2500, 3200, 5800, 10000, 40000].map((T) => s.color(T));
  ok(
    samples.every((c) => c.every((v) => v >= 0 && v <= 1 && Number.isFinite(v))),
    `scheme '${s.id}' returns valid linear RGB across the stellar range`,
  );
  ok(
    Math.abs(Math.max(...samples[0]) - 1) < 1e-9,
    `scheme '${s.id}' is peak-normalized, so colour stays independent of flux`,
  );
  // Every scheme must declare what kind of claim it makes, so a page can caption
  // it honestly instead of implying a designed palette is a measurement.
  ok(
    ["physical", "stretched", "schematic"].includes(s.kind) && s.note.length > 0,
    `scheme '${s.id}' declares its kind ('${s.kind}') and carries a caption`,
  );
}
// The physical baseline must BE the physics, not a near-copy of it.
ok(
  getScheme("true").color(9000).every((v, i) => Math.abs(v - blackbodyLinearRGB(9000)[i]) < 1e-12),
  "the 'true' scheme is exactly blackbodyLinearRGB",
);
// Stretching is monotone in chroma: true < stretched < vivid, at a fixed Teff.
const chromaAt = (id) => chromaDistance(getScheme(id).color(3200));
ok(
  chromaAt("true") < chromaAt("stretched") && chromaAt("stretched") < chromaAt("vivid"),
  "chroma increases true -> stretched -> vivid",
);
// …and stretching must preserve HUE ORDER: hot stays bluer than cool everywhere.
for (const s of COLOR_SCHEMES) {
  const cool = s.color(3200);
  const hot = s.color(20000);
  ok(
    hot[2] / (hot[0] || 1e-9) > cool[2] / (cool[0] || 1e-9),
    `scheme '${s.id}' keeps hot stars bluer than cool ones (hue order preserved)`,
  );
}
// A stretch of 1 is the identity — the knob has no hidden offset.
ok(
  stretchChroma(blackbodyLinearRGB(6000), 1).every(
    (v, i) => Math.abs(v - blackbodyLinearRGB(6000)[i]) < 1e-12,
  ),
  "stretchChroma(c, 1) is the identity",
);
ok(getScheme("nonexistent").id === "true", "an unknown scheme id falls back to true colour");

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



/* ── the instrument PSF: ONE width for the whole image ──
 * A PSF belongs to the atmosphere and optics, not to the source, so brightness
 * changes a star's PEAK INTENSITY and nothing else; a bright star looks larger
 * only because more of its wing clears the display threshold. Scaling the
 * profile width with flux instead produced soft inflated balls with no crisp
 * core, and faint stars as 1-2 px blocks — found by rendering the real cluster
 * to a PNG, which no percentile of the size distribution would have revealed. */
ok(PSF_WIDTH_PX >= MIN_RENDERABLE_PX, "the PSF spans at least one device pixel");
ok(PSF_WIDTH_PX >= 2, "…and is wide enough to read as a round point, not a block");
ok(PSF_BETA >= 2 && PSF_BETA <= 5, "Moffat beta is in the seeing-limited range");

/* Only the BILLBOARD grows with brightness, so wings have room. The profile
 * inside it is identical for every star.
 *
 * The second argument is the HALO DRIVE — a linear flux ratio, not a boolean.
 * These assertions previously passed `true`/`false`, which kept passing when the
 * parameter changed meaning because `true` coerces to a drive of 1. Numeric
 * drives, so the check says what it tests. */
const FAINT_DRIVE = 1e-6; // a median star: no halo at all
const BRIGHT_DRIVE = 25; // the brightest in the shipped population
ok(quadExtentPx(1, 0) > quadExtentPx(0, 0), "the quad grows with signal");
ok(
  quadExtentPx(0.5, BRIGHT_DRIVE) > quadExtentPx(0.5, FAINT_DRIVE),
  "…and much further for a star with a real scattered-light halo",
);
ok(quadExtentPx(0, 0) >= PSF_WIDTH_PX * 2, "even the faintest quad holds the core");
ok(
  quadExtentPx(4, 0) === quadExtentPx(1, 0),
  "an over-white star's CORE allowance does not keep growing — it is clamped",
);
// A faint star must pay nothing for a wing it cannot show. This is what the old
// tier gate got wrong: it handed every star above a percentile a fixed +10 core
// radii of quad whether or not its halo was visible.
ok(
  aureoleExtentRadii(FAINT_DRIVE, DEFAULT_AUREOLE) === 0,
  "a median star is allotted NO halo extent",
);
ok(
  aureoleExtentRadii(BRIGHT_DRIVE, DEFAULT_AUREOLE) > 10,
  "…while a bright one is allotted a broad one",
);
// The halo's threshold radius goes as drive^(1/p) — the strong size lever, since
// 1/p = 0.33 against the core's 1/(2*beta) = 0.156.
// Compared where the power law actually holds. The extent is
// scale * ((amp*drive/floor)^(1/p) - 1), and that trailing -1 makes the ratio
// STEEPER than drive^(1/p) near the cutoff (12.3x rather than 10x for a 1000x
// drive), so the asymptotic form is only recovered well above it.
{
  const lo = aureoleExtentRadii(1e3, DEFAULT_AUREOLE);
  const hi = aureoleExtentRadii(1e6, DEFAULT_AUREOLE);
  const expected = 1e3 ** (1 / DEFAULT_AUREOLE.p);
  ok(
    Math.abs(hi / lo - expected) / expected < 0.05,
    `halo extent scales as drive^(1/p) (${(hi / lo).toFixed(2)}x for 1000x, expected ~${expected.toFixed(2)}x)`,
  );
}
ok(
  quadExtentPx(1, 1e12) === MAX_QUAD_PX,
  "an unbounded drive is bounded by the cost cap, not left to grow",
);
// Sub-pixel profiles are dimmed to preserve energy, never faked wider.
ok(subpixelGain(2) === 1, "a profile wider than a pixel needs no compensation");
ok(Math.abs(subpixelGain(0.5) - 0.25) < 1e-12, "…and a sub-pixel one is dimmed by the area ratio");

/* ── Moffat PSF ── */
ok(Math.abs(moffat(0, 1, 3.2) - 1) < 1e-12, "Moffat peaks at 1 on axis");
ok(moffat(2, 1, 3.2) < moffat(1, 1, 3.2), "Moffat decreases with radius");
ok(moffat(1e3, 1, 3.2) > 0, "Moffat wings never reach exactly zero");
// beta controls wing weight: a smaller beta means MORE light in the wings.
ok(moffat(3, 1, 2.5) > moffat(3, 1, 4.5), "smaller beta puts more light in the wings");

/* ── aureole: broad and faint, never an opaque disk ── */
ok(aureole(0, DEFAULT_AUREOLE) <= DEFAULT_AUREOLE.amp, "aureole peak is faint (<= amp)");
ok(DEFAULT_AUREOLE.amp < 0.15, "…and amp is far below the core's peak of 1");
ok(
  aureole(3, DEFAULT_AUREOLE) > aureole(0, DEFAULT_AUREOLE) * 0.05,
  "aureole is BROAD — still present far out at rho=3",
);
ok(aureole(2, DEFAULT_AUREOLE) < aureole(1, DEFAULT_AUREOLE), "aureole decreases with radius");
// It must be much flatter than the PSF, or it is just a second core.
const psfDrop = moffat(2, 1, 3.2) / moffat(0.5, 1, 3.2);
const aurDrop = aureole(2, DEFAULT_AUREOLE) / aureole(0.5, DEFAULT_AUREOLE);
ok(aurDrop > psfDrop, "aureole falls off more slowly than the PSF (a wing, not a core)");

/* ── population tiers: keep the expensive path rare ── */
const fluxAsc = Array.from({ length: 10000 }, (_, i) => i);
const { tier, thresholds } = computeTiers(fluxAsc, { t2: 0.9, t3: 0.995 });
const counts = [0, 0, 0, 0];
for (const t of tier) counts[t]++;
ok(tier.length === fluxAsc.length, "one tier per star");
ok(counts[1] > counts[2] && counts[2] > counts[3], "Tier 1 is the majority, Tier 3 the rarest");
ok(Math.abs(counts[3] / fluxAsc.length - 0.005) < 0.002, "Tier 3 is ~the top 0.5%");
ok(Math.abs(counts[2] / fluxAsc.length - 0.095) < 0.005, "Tier 2 is ~the next 9.5%");
ok(counts[1] + counts[2] + counts[3] === fluxAsc.length, "every star lands in exactly one tier");
ok(thresholds.t2 < thresholds.t3, "thresholds are ordered");
// Tiering is by the star's own flux, so it must not depend on input order.
const shuffled = [...fluxAsc].reverse();
const rev = computeTiers(shuffled, { t2: 0.9, t3: 0.995 });
ok(
  rev.thresholds.t2 === thresholds.t2 && rev.thresholds.t3 === thresholds.t3,
  "thresholds are order-independent",
);
ok(rev.tier[0] === 3, "…and the brightest star is Tier 3 wherever it sits in the array");
ok(computeTiers([], { t2: 0.9, t3: 0.995 }).tier.length === 0, "empty population is safe");


/* ── the prepared field: the whole CPU path, end to end ──
 * Everything a star needs is constant across its billboard, so it is computed
 * here and not in a shader. That is what keeps the GPU-side surface down to the
 * PSF profile alone — and it means the pipeline is testable in node. */
const fake = new Float32Array(300 * 6);
for (let i = 0; i < 300; i++) {
  const o = i * 6;
  fake[o] = (i % 10) - 5;
  fake[o + 1] = ((i / 10) % 10) - 5;
  fake[o + 2] = 0;
  fake[o + 3] = 0.1 + i * 0.3;                 // mass
  fake[o + 4] = 2500 + i * 120;                // teff: M through O
  fake[o + 5] = 0.2 + i * 0.02;                // radius
}
const fld = prepareStarField(fake, { band: "V", scheme: "true" });
ok(fld.count === 300, "one entry per star");
ok(fld.position.length === 900 && fld.color.length === 900, "positions and colours are vec3 arrays");
ok(fld.signal.every((v) => v >= 0 && Number.isFinite(v)), "signals are finite and non-negative");
ok(fld.sizePx.every((v) => v >= PSF_WIDTH_PX && Number.isFinite(v)), "every billboard holds its PSF");
ok(fld.tier.every((t) => t >= 1 && t <= 3), "every star lands in a valid tier");
ok(fld.stats.whiteFlux > 0, "a positive white point is derived");
ok(fld.stats.clipping < fld.count * 0.02, "only a small fraction clips");
// Determinism: the same input must give the same GPU buffers.
const again = prepareStarField(fake, { band: "V", scheme: "true" });
ok(
  fld.signal.every((v, i) => v === again.signal[i]) && fld.color.every((v, i) => v === again.color[i]),
  "preparation is deterministic",
);
// The band genuinely changes what is visible — the physical inversion that makes
// an infrared view worth having, asserted rather than assumed.
// Measured at a LOW softening: the default lifts the whole field to visible, so
// there would be no headroom left to detect a difference.
const LOW = 1e3;
const inV = prepareStarField(fake, { band: "V", softening: LOW }).stats.visible;
const inK = prepareStarField(fake, { band: "K", softening: LOW }).stats.visible;
ok(inK > inV, "more stars are visible in K than in V (cool stars dominate the IR)");
ok(
  prepareStarField(fake, { band: "V", softening: LOW, exposure: 8 }).stats.visible > inV,
  "more exposure reveals more",
);
ok(
  prepareStarField(fake, { band: "V", softening: 1e8 }).stats.visible > inV,
  "more softening reveals more faint detail",
);
// The default must actually suit the data it ships with: a 9.6-dex population
// should be essentially all visible, which is the bug this replaced.
const shipped = prepareStarField(fake, { band: "V" });
ok(shipped.stats.visible > fake.length / 6 * 0.9, "the DEFAULT softening leaves the field visible, not black");

/* ── the POPULATION the lab actually renders ──
 *
 * Everything above runs on a synthetic 300-star array, which is the right way to
 * test the transfer but says nothing about the stars on screen. This block
 * asserts against the real producer, because the worst bug in this pipeline was
 * never in the maths.
 *
 * The gravoturb export's star POSITIONS are quantized to the 128^3 gas grid with
 * uniform sub-cell jitter: its 10,301 stars occupied 139 distinct cells of
 * 6.0/128 = 0.046875 pc, and ONE cell held 7,973 of them (77.4%). Rendered, 77%
 * of the cluster piled into a single ~15 px disc and additive blending saturated
 * it into a flat white blob — read for a whole session as a shader bug ("stars
 * render as filled squares") because a pile and a broken PSF look alike. The
 * shader was correct the entire time.
 *
 * A pile is invisible to every assertion above: the fluxes, colours, tiers and
 * exposure were all exactly right for the stars it contained. So the check has
 * to be on the SPATIAL distribution, and it has to run on the producer rather
 * than on a fixture, since a fixture is chosen and a producer is not.
 */
const table = clusterStarTable({ sampling: { mode: "count", target: 4000 } });
const nStars = table.length / STAR_STRIDE;
ok(nStars === 4000, "the cluster producer honours its requested star count");

const CELL_PC = 6.0 / 128; // the grid the historical pile was quantized to
const occupancy = new Map();
for (let i = 0; i < nStars; i++) {
  const o = i * STAR_STRIDE;
  const key = [0, 1, 2].map((j) => Math.floor(table[o + j] / CELL_PC)).join(",");
  occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
}
const densest = Math.max(...occupancy.values());
ok(
  densest < nStars * 0.02,
  `no cell holds more than 2% of the cluster (densest holds ${(densest / nStars * 100).toFixed(2)}%)`,
);
ok(
  occupancy.size > nStars * 0.5,
  `positions are continuous, not grid-quantized (${occupancy.size} cells for ${nStars} stars)`,
);

// Derived stellar state must be physical, not zero-filled: a zero radius or a
// zero Teff is silently zero flux, which renders as a star that simply is not
// there rather than as an error.
let badTeff = 0;
let badRadius = 0;
for (let i = 0; i < nStars; i++) {
  const o = i * STAR_STRIDE;
  if (!(table[o + 4] > 1000)) badTeff++;
  if (!(table[o + 5] > 0)) badRadius++;
}
ok(badTeff === 0, "every sampled star has a physical Teff");
ok(badRadius === 0, "every sampled star has a positive radius");

// The producer is deterministic in its seed — the lab URL must be stable.
const again2 = clusterStarTable({ sampling: { mode: "count", target: 4000 } });
ok(table.every((v, i) => v === again2[i]), "the cluster producer is deterministic in its seed");

// And the whole pipeline must survive it: a real population, all visible.
const real = prepareStarField(table, { band: "V" });
ok(real.stats.visible > nStars * 0.9, "the sampled cluster renders visible, not black");

/* ── the CPU REFERENCE, and the profile the shader mirrors ──
 *
 * `starProfile` is the whole surface the TSL graph restates, and the reference
 * rasteriser calls it directly — so "does the GPU match the reference?" reduces to
 * one function rather than two renderers. The previous reference answered a
 * different question: it chose its own beta (2.8 vs 3.2), PSF width (1.3 vs 2.2 px)
 * and aureole, and tone-mapped with Reinhard, so it could look right while the
 * shader squared the profile. */
{
  const P = { signal: 1, halo: 0, aureole: DEFAULT_AUREOLE, beta: PSF_BETA };
  const edge = 20;
  ok(Math.abs(starProfile({ ...P, rho: 0, edge }) - (1 - moffat(edge, 1, PSF_BETA))) < 1e-12,
    "on axis the profile is the Moffat peak minus its own pedestal");
  ok(starProfile({ ...P, rho: edge, edge }) === 0, "…and reaches EXACTLY zero at the quad edge");
  ok(starProfile({ ...P, rho: edge * 1.5, edge }) === 0, "…and nothing outside the billboard");
  ok(starProfile({ ...P, rho: 2, edge }) < starProfile({ ...P, rho: 1, edge }),
    "the profile decreases with radius");
  // The two drives are genuinely independent: halo alone still produces light.
  ok(starProfile({ ...P, signal: 0, halo: 10, rho: 1, edge }) > 0,
    "a star with no display signal still shows its scattered-light halo");
  ok(starProfile({ ...P, signal: 1, halo: 0, rho: 1, edge }) > 0,
    "…and a star with no halo still shows its core");
  // Doubling the halo drive doubles the halo term, so the wing is LINEAR in flux —
  // the property that gives apparent size its range.
  const a = starProfile({ ...P, signal: 0, halo: 1, rho: 3, edge });
  const b = starProfile({ ...P, signal: 0, halo: 2, rho: 3, edge });
  ok(Math.abs(b / a - 2) < 1e-9, "the halo is linear in the flux that drives it");
}

/* The reference rasteriser must produce a real image of the real cluster, and one
 * whose brightest pixel sits where the projection says it should. */
{
  const field = prepareStarField(table, { band: "V" });
  const cam = { width: 200, height: 200, distancePc: 8, fovDeg: 45 };
  const img = renderReference(field, cam);
  ok(img.rgb.length === cam.width * cam.height * 3, "the reference image is the size requested");
  let lit = 0;
  let peak = 0;
  let peakAt = -1;
  for (let p = 0; p < cam.width * cam.height; p++) {
    const v = img.rgb[p * 3] + img.rgb[p * 3 + 1] + img.rgb[p * 3 + 2];
    if (v > 1e-6) lit++;
    if (v > peak) { peak = v; peakAt = p; }
  }
  ok(lit > 0, "the reference renders something");
  ok(lit < cam.width * cam.height, "…and not everything (there is sky)");
  ok(Number.isFinite(peak) && peak > 0, "…with a finite positive peak");
  ok(img.rgb.every((v) => v >= 0), "…and no negative radiance anywhere");
  // A centrally concentrated cluster viewed down its own axis must peak near the
  // middle. Catches a projection sign error, which otherwise renders a plausible
  // image that is simply mirrored.
  const cx = peakAt % cam.width;
  const cy = Math.floor(peakAt / cam.width);
  ok(Math.abs(cx - cam.width / 2) < cam.width * 0.25 && Math.abs(cy - cam.height / 2) < cam.height * 0.25,
    `the reference peaks near frame centre (${cx}, ${cy})`);
  // A mass cut must remove light from the reference too, not just from the GPU.
  const cutImg = renderReference(prepareStarField(table, { band: "V", minMass: 1 }), cam);
  let sumAll = 0;
  let sumCut = 0;
  for (let i = 0; i < img.rgb.length; i++) { sumAll += img.rgb[i]; sumCut += cutImg.rgb[i]; }
  ok(sumCut < sumAll, "a mass cut removes light from the reference as well");
}

/* ── DEPTH is a statement, not a tuning number ──
 *
 * `k = 3e7` cannot be checked, compared or reported. The same exposure expressed
 * as "reaches 19.8 mag below the white point" can be all three, which is what
 * makes the faint end inspectable: nothing on the page previously revealed that
 * the default stretch shows 20th-magnitude stars at a third of display white. */
ok(limitingFluxRatio(1e6) < limitingFluxRatio(1e3), "a larger softening reaches fainter");
ok(magnitudeDifference(limitingFluxRatio(1e6)) > magnitudeDifference(limitingFluxRatio(1e3)),
  "…which is more magnitudes below white");
// The inverse must actually invert. It did NOT on the first attempt: the search
// direction was written the intuitive way round, but limitingFluxRatio DECREASES
// in k, so a 10-mag request returned the deep bracket end (30.6 mag) and a 20-mag
// request the shallow one (5.6 mag) — silently, since both are valid softenings.
{
  let worst = 0;
  for (const d of [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 30]) {
    const k = softeningForLimit(fluxRatioForMagnitudes(d));
    worst = Math.max(worst, Math.abs(magnitudeDifference(limitingFluxRatio(k)) - d));
  }
  ok(worst < 1e-9, `depth -> softening -> depth round-trips (worst error ${worst.toExponential(1)} mag)`);
}
// A star exactly at the stated depth must land on the threshold — the definition.
{
  const k = softeningForLimit(fluxRatioForMagnitudes(15));
  const s = asinhResponse(fluxRatioForMagnitudes(15), 1, k, 1);
  ok(Math.abs(s - VISIBILITY_THRESHOLD) < 1e-9,
    "a star at the stated depth sits exactly on the visibility threshold");
}
// Requests outside the bracket saturate rather than throwing or returning NaN.
ok(Number.isFinite(softeningForLimit(fluxRatioForMagnitudes(1))), "an absurdly shallow depth is clamped, not NaN");
ok(Number.isFinite(softeningForLimit(fluxRatioForMagnitudes(60))), "an absurdly deep depth is clamped, not NaN");
ok(softeningForLimit(0) > 0, "a zero-flux limit degrades to the deepest exposure");

/* ── the mass cut is a SELECTION, and must not re-expose the image ──
 *
 * The white point stays calibrated on the full population, so cutting the faint
 * majority changes which stars are drawn and not how bright the rest are. If it
 * re-normalized, the two views would not be comparable and the cut would silently
 * brighten everything left. */
{
  const full = prepareStarField(table, { band: "V" });
  const cut = prepareStarField(table, { band: "V", minMass: 1 });
  ok(cut.stats.whiteFlux === full.stats.whiteFlux, "a mass cut leaves the white point untouched");
  ok(cut.stats.shown < full.stats.shown, "…and draws fewer stars");
  ok(cut.stats.shown > 0, "…but not none");
  // Every surviving star keeps the exact signal it had.
  let moved = 0;
  for (let i = 0; i < cut.count; i++) {
    if (cut.signal[i] > 0 && Math.abs(cut.signal[i] - full.signal[i]) > 1e-12) moved++;
  }
  ok(moved === 0, "…and every star that survives keeps the brightness it had");
}

/* ── brightness must not depend on COLOUR ──
 *
 * Chromaticity is rescaled to unit luminance so the display signal alone sets how
 * bright a star reads. Peak-normalized, luminance ran 0.49 at 2500 K, 0.90 at
 * 5772 K and 0.48 at 45000 K, so a Sun-like star rendered 1.86x more luminous
 * than an O star at the SAME signal — colour cancelling the exposure's ordering,
 * and measured peak brightness came out non-monotonic in luminosity. */
for (const T of [2500, 3500, 5772, 12000, 30000, 45000]) {
  const y = relativeLuminance(unitLuminanceChroma(getScheme("true").color(T)));
  ok(Math.abs(y - 1) < 1e-9, `unit-luminance colour at ${T} K carries luminance 1, not ${y.toFixed(3)}`);
}
// Hue is untouched — only the scale changes. Ratios between channels must survive.
{
  const peakN = getScheme("true").color(30000);
  const unitN = unitLuminanceChroma(peakN);
  const ratio = (a, b) => a / b;
  ok(
    Math.abs(ratio(unitN[2], unitN[0]) - ratio(peakN[2], peakN[0])) < 1e-9,
    "…and the blue/red ratio is unchanged, so the hue is the scheme's, not ours",
  );
}
// Out-of-gamut channels are EXPECTED for a saturated colour and must not be
// clamped — clamping would put the Teff-dependent luminance straight back.
ok(
  Math.max(...unitLuminanceChroma(getScheme("true").color(45000))) > 1,
  "a saturated colour legitimately exceeds 1 in linear HDR",
);

/* ── the inverse-square law applies WITHIN the cluster ──
 *
 * Depth is the star's own z in the cluster frame, never the live camera's axis:
 * a cluster 400 pc away cannot be orbited, and deriving depth from the camera
 * would make brightness pump as the view rotates. */
{
  const near = new Float32Array([0, 0, 100, 1, 5772, 1]); // 100 pc nearer
  const far = new Float32Array([0, 0, -100, 1, 5772, 1]); // 100 pc further
  const pair = new Float32Array(12);
  pair.set(near, 0);
  pair.set(far, 6);
  const f = prepareStarField(pair, { band: "V" });
  ok(f.halo[0] > f.halo[1], "a nearer star of identical type is brighter");
  // (400-(-100))^2 / (400-100)^2 = 500^2/300^2 = 2.78
  const expected = (D0_PC + 100) ** 2 / (D0_PC - 100) ** 2;
  const got = f.halo[0] / f.halo[1];
  ok(
    Math.abs(got - expected) / expected < 1e-3,
    `…by exactly the inverse-square ratio (${got.toFixed(3)} vs ${expected.toFixed(3)})`,
  );
}

/* ── APPARENT SIZE must vary across the population ──
 *
 * The defect this replaced: measured in the browser, every star from 3 to 100
 * Msun rendered at an identical 4.51 px — 4.2 dex of luminosity with no size
 * variation at all — because the halo was scaled by the compressed display signal
 * and so inherited the asinh compression. Asserted on the quad extent, which is
 * derived from the same drive the shader uses, so the two cannot disagree. */
{
  const f = prepareStarField(table, { band: "V" });
  const sizes = Array.from(f.sizePx).sort((a, b) => a - b);
  const med = sizes[Math.floor(sizes.length / 2)];
  const max = sizes[sizes.length - 1];
  ok(max / med > 3, `the brightest star's billboard dwarfs the median (${(max / med).toFixed(1)}x)`);
  // …and it must not be a cliff: sizes should be spread, not two clusters.
  const p90 = sizes[Math.floor(sizes.length * 0.9)];
  ok(p90 > med && max > p90, "billboard size is graded, not a two-state step");
}

process.exit(failures ? 1 : 0);
