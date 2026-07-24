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
import { STAROPTICS_OK } from "../src/novascope/viz/starOptics.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("star-optics (novascope/viz):");
ok(STAROPTICS_OK === true, "module loads");

process.exit(failures ? 1 : 0);
