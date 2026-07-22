/*
 * check-stellar.mjs — validate src/lib/stellar.ts against startrax.
 *
 * The stellar relations are a TypeScript PORT of startrax's verified Tout 1996 /
 * Hurley 2000 code. This harness is the parity gate: it asserts the port
 * reproduces a committed fixture of startrax's own outputs
 * (scripts/fixtures/stellar-startrax.json) at a mass grid, plus a few physical
 * landmarks. Run with `node --experimental-strip-types`; exits 1 on any failure.
 * Mirrors scripts/check-sun.mjs. Wired into prebuild.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  zamsLuminosity,
  zamsRadius,
  effectiveTemperature,
  zamsTeff,
  spectralType,
  msLifetime,
  remnantFate,
} from "../src/lib/stellar.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(HERE, "fixtures/stellar-startrax.json"), "utf8"),
);

const problems = [];
const relErr = (a, b) => Math.abs(a - b) / Math.abs(b);
const check = (name, got, want, tol) => {
  const e = relErr(got, want);
  const ok = e <= tol;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${name}: got ${got.toPrecision(6)}, want ${want.toPrecision(6)} (relErr ${e.toExponential(1)})`,
  );
  if (!ok) problems.push(`${name}: ${got} vs ${want} (relErr ${e.toExponential(2)} > ${tol})`);
};

console.log("stellar.ts vs startrax fixture (ZAMS, Z=0.02):");
for (const r of fixture.rows) {
  const tag = `M=${r.m}`;
  check(`${tag} L`, zamsLuminosity(r.m), r.L, 1e-3);
  check(`${tag} R`, zamsRadius(r.m), r.R, 1e-3);
  check(`${tag} Teff`, zamsTeff(r.m), r.Teff, 1e-3);
  check(`${tag} tMS`, msLifetime(r.m), r.tMS_Myr, 1e-3);
}

console.log("\nphysical landmarks:");
// ZAMS Sun (not present-day): dimmer, cooler — a real, correct feature.
check("ZAMS Sun Teff", zamsTeff(1.0), 5597, 2e-3);
check("Stefan-Boltzmann Sun (L=1,R=1)", effectiveTemperature(1, 1), 5772.0, 1e-4);

console.log("\nspectral-type class boundaries (Pecaut & Mamajek 2013):");
for (const [teff, want] of [
  [40000, "O"], [20000, "B"], [9000, "A"], [6500, "F"], [5772, "G"], [4500, "K"], [3200, "M"],
]) {
  const got = spectralType(teff);
  const ok = got[0] === want;
  console.log(`  ${ok ? "ok  " : "FAIL"}  Teff ${teff} -> ${got} (class ${want})`);
  if (!ok) problems.push(`spectralType(${teff}) = ${got}, expected class ${want}`);
}

console.log("\nremnant fate thresholds (Heger 2003):");
for (const [m, want] of [
  [1, "white dwarf"], [7, "white dwarf"], [15, "neutron star"], [40, "black hole"],
]) {
  const got = remnantFate(m);
  const ok = got === want;
  console.log(`  ${ok ? "ok  " : "FAIL"}  M=${m} -> ${got}`);
  if (!ok) problems.push(`remnantFate(${m}) = ${got}, expected ${want}`);
}

if (problems.length > 0) {
  console.error(`\n[stellar] ${problems.length} check(s) failed:\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}
console.log(`\n[stellar] ok — ${fixture.rows.length} masses match startrax within tolerance.`);
