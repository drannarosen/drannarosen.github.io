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
import { deriveLogL, apparentFlux, D0_PC, blackbodyLinearRGB } from "../src/novascope/viz/starOptics.ts";
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

process.exit(failures ? 1 : 0);
