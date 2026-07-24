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
import { deriveLogL, apparentFlux, D0_PC, distanceModulus, apparentMagnitude, absoluteMagnitude } from "../src/novascope/core/photometry/index.ts";
import {
  blackbodyLinearRGB,
  linearToSrgbRGB,
  spectrumToXYZ,
  spectrumLinearRGB,
} from "../src/novascope/core/colorimetry/index.ts";
import { planckNm, wienPeakLambda, NM_TO_CM } from "../src/novascope/core/blackbody/index.ts";
import { COLOR_SCHEMES, getScheme, stretchChroma } from "../src/novascope/core/colorimetry/schemes.ts";
import { PASSBANDS, bandFlux, bandIntegral, colorIndex, bandResponse, VEGA_TEFF_K, BAND_COMPOSITES } from "../src/novascope/core/photometry/passbands.ts";
import { moffat, aureole, DEFAULT_AUREOLE } from "../src/novascope/core/optics/index.ts";
import { robustWhiteFlux, asinhResponse, DEFAULT_SOFTENING } from "../src/novascope/core/imaging/index.ts";
import {
  coreRadiusPx,
  computeTiers,
  scaleCoreParams,
  subpixelGain,
  DEFAULT_CORE,
} from "../src/novascope/viz/starfield/sizing.ts";
import { prepareStarField } from "../src/novascope/viz/starfield/prepare.ts";
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



/* ── core radius: BOUNDED, and decoupled from the brightness law ──
 * The legacy renderer mapped luminosity to billboard DIAMETER, so the brightest
 * stars were also the largest quads — maximum overlap area exactly where the
 * cluster is densest. Size must be a weak, bounded function of flux; luminosity
 * drives RADIANCE instead. */
for (const F of [0, 1e-6, 1e-3, 1, 1e3, 1e6, 1e9]) {
  const rpx = coreRadiusPx(F, DEFAULT_CORE);
  ok(
    rpx >= DEFAULT_CORE.coreMin - 1e-9 && rpx <= DEFAULT_CORE.coreMax + 1e-9,
    `core radius bounded at F=${F} (${rpx.toFixed(2)} px)`,
  );
}
/* Core sizes are authored in CSS PIXELS and scaled by devicePixelRatio at
 * preparation. Treating them as device px (the literal reading of a "0.7-1.6 px
 * crisp core" brief) puts a core below half a device pixel at DPR 2, where the
 * profile falls between sample points and the field renders empty. What the
 * brief actually protects — size being a WEAK, BOUNDED function of flux, so
 * brightness lives in radiance and the dense core cannot bloom — is asserted
 * directly below instead of via a specific pixel ceiling. */
ok(DEFAULT_CORE.coreMax <= 10, "the brightest core stays a few CSS px, not a disk");
ok(DEFAULT_CORE.coreMin >= 1, "…and the faintest still spans a device pixel at DPR 1");
ok(
  scaleCoreParams(DEFAULT_CORE, 2).coreMax === DEFAULT_CORE.coreMax * 2,
  "core params scale linearly with devicePixelRatio",
);
ok(subpixelGain(2) === 1, "a core wider than a pixel needs no compensation");
ok(subpixelGain(0.5) < 1 && subpixelGain(0.5) > 0, "…and a sub-pixel core is dimmed, not brightened");
// A zero-flux star sits at r0. coreMin is a defensive clamp below it, so it does
// not bind at the defaults — assert the real property, not r0 === coreMin.
ok(coreRadiusPx(0, DEFAULT_CORE) === DEFAULT_CORE.r0, "a zero-flux star sits at r0");
ok(coreRadiusPx(0, DEFAULT_CORE) >= DEFAULT_CORE.coreMin, "…and never below the floor");
ok(
  coreRadiusPx(0, { ...DEFAULT_CORE, r0: 0.1 }) === DEFAULT_CORE.coreMin,
  "the floor does bind when r0 is pushed below it",
);
// Weak growth: 6 dex of flux must not span the whole size range linearly.
const rFaint = coreRadiusPx(1, DEFAULT_CORE);
const rBright = coreRadiusPx(1e6, DEFAULT_CORE);
ok(rBright > rFaint, "core grows with flux (monotone)");
ok(rBright / rFaint < 4, "…but only weakly — size is not the brightness law");

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
ok(fld.sizePx.every((v) => v >= DEFAULT_CORE.coreMin && v <= DEFAULT_CORE.coreMax), "every core is bounded");
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
const inV = prepareStarField(fake, { band: "V" }).stats.visible;
const inK = prepareStarField(fake, { band: "K" }).stats.visible;
ok(inK > inV, "more stars are visible in K than in V (cool stars dominate the IR)");
// Exposure and softening move visibility in the expected direction.
ok(prepareStarField(fake, { band: "V", exposure: 4 }).stats.visible >= inV, "more exposure reveals more");
ok(
  prepareStarField(fake, { band: "V", softening: 1e6 }).stats.visible >= inV,
  "more softening reveals more faint detail",
);

process.exit(failures ? 1 : 0);
