/*
 * check-imf.mjs — build gate: novascope's Maschberger IMF must reproduce
 * progenax's, the same way check-stellar pins stellar.ts to startrax.
 * Validates the analytic quantile (ppf) and the CDF fractions against a
 * committed progenax fixture (scripts/fixtures/imf-maschberger-progenax.json),
 * so the port cannot silently drift from Anna's own code.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { maschbergerMass, maschbergerMassFraction } from "../src/novascope/core/imf/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(resolve(HERE, "fixtures/imf-maschberger-progenax.json"), "utf8"));

let problems = 0;
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));

console.log("Maschberger IMF vs progenax fixture (μ=0.2, β=1.4, [0.1, 100] M☉):");
for (const row of fx.rows) {
  const p = { mMin: fx.m_min, mMax: fx.m_max, alpha: row.alpha, mu: fx.mu, beta: fx.beta };
  let maxErr = 0;
  for (let i = 0; i < row.us.length; i++) {
    maxErr = Math.max(maxErr, rel(maschbergerMass(row.us[i], p), row.ppf[i]));
  }
  const okPpf = maxErr < 1e-3;
  console.log(`  ${okPpf ? "ok  " : "FAIL"}  α=${row.alpha}: ppf max rel err ${maxErr.toExponential(2)}`);
  if (!okPpf) problems++;

  for (const [mStr, frac] of Object.entries(row.cdf_frac)) {
    const got = maschbergerMassFraction(fx.m_min, Number(mStr), p);
    const okF = rel(got, frac) < 1e-3;
    console.log(`  ${okF ? "ok  " : "FAIL"}  α=${row.alpha}: F(<${mStr} M☉) = ${got.toFixed(4)} (progenax ${frac.toFixed(4)})`);
    if (!okF) problems++;
  }
}

if (problems > 0) {
  console.error(`\n[imf] ${problems} check(s) FAILED — the Maschberger port diverges from progenax.`);
  process.exit(1);
}
console.log(`\n[imf] ok — Maschberger matches progenax across ${fx.rows.length} slopes.`);
