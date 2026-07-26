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
import {
  maschbergerMass,
  maschbergerMassFraction,
  alpha3FromEnvironment,
  buildKroupaSegments,
  sampleKroupaMass,
  kroupaMassFraction,
} from "../src/novascope/core/imf/index.ts";

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

// Environment-dependent α₃ (Jerabkova/Marks) vs progenax fixture.
const envFx = JSON.parse(readFileSync(resolve(HERE, "fixtures/imf-env-progenax.json"), "utf8"));
console.log("\nenvironment α₃ vs progenax (Jerabkova+2018 mass-based):");
let envMax = 0;
for (const r of envFx.rows) {
  envMax = Math.max(envMax, Math.abs(alpha3FromEnvironment(r.feh, 1e6 * 10 ** r.logMecl6) - r.alpha3));
}
const okEnv = envMax < 1e-3;
console.log(`  ${okEnv ? "ok  " : "FAIL"}  α₃([Fe/H], M_ecl) max abs err ${envMax.toExponential(2)} over ${envFx.rows.length} points`);
if (!okEnv) problems++;

/* ── KROUPA, which became selectable and had no coverage at all ──
 *
 * There is no progenax fixture for Kroupa, and one must NOT be invented — a fixture generated
 * from this same code would certify nothing. What can be asserted without one is the law's own
 * mathematics: a normalised CDF, continuity across the 0.5 M☉ break, a monotone quantile that
 * stays in range, and the slope knob moving the high-mass end the right way. Those are properties
 * of Kroupa (2001), not of this implementation, so they cannot drift with it.
 */
console.log("\nKroupa (2001) — analytic properties, no fixture:");
{
  const segs = buildKroupaSegments(0.1, 100);

  const full = kroupaMassFraction(0.1, 100, segs);
  const okNorm = Math.abs(full - 1) < 1e-12;
  console.log(`  ${okNorm ? "ok  " : "FAIL"}  the CDF integrates to 1 over [0.1, 100] (${full})`);
  if (!okNorm) problems++;

  /* Continuity at the break: the amplitudes are chosen so ξ(m) has no step at 0.5 M☉. A step
   * would show as the fraction either side disagreeing across a vanishing interval. */
  const eps = 1e-6;
  const below = kroupaMassFraction(0.5 - eps, 0.5, segs);
  const above = kroupaMassFraction(0.5, 0.5 + eps, segs);
  const okCont = Math.abs(below - above) / Math.max(below, above) < 1e-3;
  console.log(
    `  ${okCont ? "ok  " : "FAIL"}  ξ is continuous across the 0.5 M☉ break ` +
      `(${below.toExponential(3)} vs ${above.toExponential(3)})`,
  );
  if (!okCont) problems++;

  let monotone = true;
  let inRange = true;
  let prev = -Infinity;
  for (let i = 0; i <= 1000; i++) {
    const m = sampleKroupaMass(i / 1000, segs);
    if (m < prev) monotone = false;
    if (m < 0.1 - 1e-9 || m > 100 + 1e-9) inRange = false;
    prev = m;
  }
  console.log(`  ${monotone ? "ok  " : "FAIL"}  the quantile is monotone in u`);
  if (!monotone) problems++;
  console.log(`  ${inRange ? "ok  " : "FAIL"}  …and never leaves [mMin, mMax]`);
  if (!inRange) problems++;

  /* The slope knob, which the IMF chapter varies: flattening α₃ must put more stars above 10 M☉. */
  const steep = kroupaMassFraction(10, 100, buildKroupaSegments(0.1, 100, 2.8));
  const flat = kroupaMassFraction(10, 100, buildKroupaSegments(0.1, 100, 1.7));
  const okSlope = flat > steep;
  console.log(
    `  ${okSlope ? "ok  " : "FAIL"}  a flatter α₃ predicts more stars above 10 M☉ ` +
      `(${(100 * flat).toFixed(2)}% vs ${(100 * steep).toFixed(2)}%)`,
  );
  if (!okSlope) problems++;
}

if (problems > 0) {
  console.error(`\n[imf] ${problems} check(s) FAILED — the port diverges from progenax.`);
  process.exit(1);
}
console.log(`\n[imf] ok — Maschberger + environment α₃ match progenax; Kroupa is self-consistent.`);
