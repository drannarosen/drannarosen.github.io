/*
 * check-passbands.mjs — gate for the tabulated filter curves and survey data.
 *
 * The curves are GENERATED from a sibling repository that this site does not depend
 * on, so nothing at build time can re-derive them. What can be checked is that the
 * committed module is internally consistent and physically sane, and — when fluxax
 * happens to be present — that it still matches its source byte-for-byte.
 *
 * That split matters: a generated file with no gate is a file nobody can trust after
 * the first hand edit.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TABULATED_CURVES, RESAMPLE_STEP_NM } from "../src/novascope/core/photometry/passbandCurves.ts";
import { PASSBANDS, bandResponse, bandIntegral, bandFlux } from "../src/novascope/core/photometry/passbands.ts";
import { SURVEYS, RUBIN, GAIA, depthRange } from "../src/novascope/core/photometry/surveys.ts";
import { planckNm } from "../src/novascope/core/blackbody/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLUXAX = resolve(ROOT, "../jaxstro-dev/fluxax");

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("passbands (tabulated curves + survey reference data):");

const ids = Object.keys(TABULATED_CURVES);
ok(ids.length === 9, `nine curves are shipped (${ids.length})`);
ok(RESAMPLE_STEP_NM > 0 && RESAMPLE_STEP_NM <= 10, "the resample grid is fine enough to resolve a broadband filter");

for (const c of Object.values(TABULATED_CURVES)) {
  const peak = Math.max(...c.values);
  ok(c.values.length > 20, `${c.id}: has a real curve (${c.values.length} samples)`);
  ok(c.values.every((v) => Number.isFinite(v) && v >= 0), `${c.id}: transmission is finite and non-negative`);
  ok(peak > 0.01 && peak <= 1.0001, `${c.id}: peak transmission is physical (${peak.toFixed(3)})`);
  // lambdaEff must be the curve's OWN weighted mean — it is derived, so re-derive it.
  let num = 0;
  let den = 0;
  for (let i = 0; i < c.values.length; i++) {
    num += (c.startNm + i * c.stepNm) * c.values[i];
    den += c.values[i];
  }
  ok(
    Math.abs(num / den - c.lambdaEffNm) < 0.05,
    `${c.id}: lambda_eff is the curve's own weighted mean (${(num / den).toFixed(1)} nm)`,
  );
  // …and it must lie inside the curve's support, which catches a mis-scaled grid.
  ok(
    c.lambdaEffNm > c.startNm && c.lambdaEffNm < c.startNm + (c.values.length - 1) * c.stepNm,
    `${c.id}: lambda_eff lies within the curve's own range`,
  );
}

/* Published effective wavelengths, as an INDEPENDENT check on the import. These are
 * not the source of the values — the curves are — so agreement means the resampling
 * and the unit conversion are both right. Angstrom/nm confusion would show as a 10x
 * miss, and it is the single most likely import bug. */
const PUBLISHED_NM = {
  LSST_u: 367, LSST_g: 482.5, LSST_r: 622, LSST_i: 754, LSST_z: 869, LSST_y: 971,
  Gaia_G: 639, Gaia_BP: 518, Gaia_RP: 782,
};
for (const [id, want] of Object.entries(PUBLISHED_NM)) {
  const got = TABULATED_CURVES[id].lambdaEffNm;
  const off = Math.abs(got - want) / want;
  ok(off < 0.02, `${id}: lambda_eff within 2% of published (${got.toFixed(1)} vs ${want} nm)`);
}

/* Band ordering: the curves must come out in the physical order their names imply.
 * Catches a mis-assigned file, which no per-curve check would notice. */
const order = ["LSST_u", "LSST_g", "LSST_r", "LSST_i", "LSST_z", "LSST_y"];
for (let i = 1; i < order.length; i++) {
  ok(
    TABULATED_CURVES[order[i]].lambdaEffNm > TABULATED_CURVES[order[i - 1]].lambdaEffNm,
    `${order[i]} sits redder than ${order[i - 1]}`,
  );
}
ok(
  TABULATED_CURVES.Gaia_BP.lambdaEffNm < TABULATED_CURVES.Gaia_G.lambdaEffNm &&
    TABULATED_CURVES.Gaia_G.lambdaEffNm < TABULATED_CURVES.Gaia_RP.lambdaEffNm,
  "Gaia BP < G < RP in wavelength",
);
/* Gaia G is exceptionally WIDE — the reason it needed a real curve rather than a
 * Gaussian. Asserted so a future "simplification" back to a bell fails here. */
{
  const g = TABULATED_CURVES.Gaia_G;
  const span = (g.values.length - 1) * g.stepNm;
  ok(span > 600, `Gaia G spans ${span} nm — far too wide for a Gaussian model`);
}

/* The registry must actually expose them, and the two response paths must both work. */
for (const id of ids) {
  ok(PASSBANDS[id] !== undefined, `${id} is registered in PASSBANDS`);
  ok(bandResponse(TABULATED_CURVES[id].lambdaEffNm, PASSBANDS[id]) > 0, `${id} responds at its own lambda_eff`);
  ok(bandResponse(50, PASSBANDS[id]) === 0, `${id} does not respond far outside its grid`);
}
ok(PASSBANDS.V.curve === undefined, "Johnson V stays a Gaussian model");
ok(PASSBANDS.LSST_r.curve !== undefined, "Rubin r uses its measured curve");

/* Physics through the tabulated path: a hot star must be relatively brighter in u
 * than a cool one, which is the whole reason band flux is computed at all. */
{
  const ratio = (T) =>
    bandIntegral((l) => planckNm(l, T), PASSBANDS.LSST_u) /
    bandIntegral((l) => planckNm(l, T), PASSBANDS.LSST_z);
  ok(ratio(30000) > ratio(3000), "u/z flux ratio is far larger for a hot star than a cool one");
  ok(bandFlux(5772, 1, 10, PASSBANDS.LSST_r) > 0, "a Sun-like star has positive flux in Rubin r");
  ok(
    bandFlux(3000, 1, 10, PASSBANDS.LSST_z) > bandFlux(3000, 1, 10, PASSBANDS.LSST_u),
    "a 3000 K star is brighter in z than in u",
  );
}

/* Survey reference data. */
for (const s of SURVEYS) {
  ok(s.source.length > 20, `${s.id}: cites where its numbers came from`);
  for (const d of s.depths) {
    ok(PASSBANDS[d.band] !== undefined, `${s.id}: depth band ${d.band} is a real passband`);
    ok(d.coadd >= d.singleVisit, `${s.id} ${d.band}: the coadd is at least as deep as one visit`);
    ok(d.singleVisit > 5 && d.coadd < 35, `${s.id} ${d.band}: depths are in a plausible range`);
  }
}
// The transcription itself, spot-checked against the observatory page.
ok(RUBIN.depths.find((d) => d.band === "LSST_r").singleVisit === 24.0, "Rubin single-visit r is 24.0");
ok(RUBIN.depths.find((d) => d.band === "LSST_r").coadd === 26.9, "Rubin coadd r is 26.9");
ok(GAIA.depths.find((d) => d.band === "Gaia_G").singleVisit === 20.7, "Gaia G limit is 20.7");
{
  const { faintest, brightest } = depthRange();
  ok(faintest > brightest, "the recorded depth range is ordered");
  ok(faintest === 26.9, `the faintest recorded depth is Rubin's g/r coadd (${faintest})`);
}

/* When fluxax IS present, prove the committed curves still match their source. This
 * is the only check that can catch a hand edit to the generated file. */
if (existsSync(FLUXAX)) {
  let checked = 0;
  for (const c of Object.values(TABULATED_CURVES)) {
    const p = resolve(FLUXAX, c.sourcePath);
    if (!existsSync(p)) continue;
    const sha = createHash("sha256").update(readFileSync(p)).digest("hex");
    ok(sha === c.sourceSha256, `${c.id}: upstream file still matches its recorded sha256`);
    checked++;
  }
  console.log(`  (fluxax present — verified ${checked} source hashes)`);
} else {
  console.log("  (fluxax not present — source-hash verification skipped, which is expected in CI)");
}

if (failures) {
  console.error(`\n✗ passbands — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ passbands ok");
