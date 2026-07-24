/*
 * check-constants.mjs — build gate for core/constants (ADR 0012 Layer 0, ADR 0015).
 *
 * Two jobs:
 *   1. the values are the IAU 2015 / CODATA ones, and the DERIVED ones agree
 *      with the modules that consume them (no silent numerical drift);
 *   2. nothing outside core/constants re-declares a physical constant.
 *
 * (2) is the point of the module. Before it existed, L_sun, R_sun, sigma_SB and
 * 5772 were each declared in several files — copies that can drift without
 * anything failing. Deriving what can be derived and gating the rest is the
 * repo's standard shape (check-sun, check-type, check-figures).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  L_SUN_ERG_S,
  R_SUN_CM,
  GM_SUN_CGS,
  SIGMA_SB_CGS,
  C_CM_S,
  PLANCK_H_CGS,
  K_B_CGS,
  T_SUN_K,
  PC_CM,
  AU_CM,
} from "../src/novascope/core/constants/index.ts";
import { effectiveTemperature } from "../src/novascope/core/stellar/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PKG = resolve(ROOT, "src/novascope");
const CONSTANTS_FILE = resolve(PKG, "core/constants/index.ts");

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("constants (novascope/core):");

/* ── 1. the values themselves ── */
ok(L_SUN_ERG_S === 3.828e33, "L_sun = 3.828e33 erg/s (IAU 2015 B3 nominal)");
ok(R_SUN_CM === 6.957e10, "R_sun = 6.957e10 cm (IAU 2015 B3 nominal)");
ok(GM_SUN_CGS === 1.3271244e26, "GM_sun = 1.3271244e26 cm^3/s^2 (IAU 2015 B3 nominal)");
ok(SIGMA_SB_CGS === 5.670374419e-5, "sigma_SB = 5.670374419e-5 CGS (CODATA 2018)");
// SI-exact defining constants: unifying a duplicate of one can never move a result.
ok(C_CM_S === 2.99792458e10, "c = 2.99792458e10 cm/s (SI exact)");
ok(PLANCK_H_CGS === 6.62607015e-27, "h = 6.62607015e-27 erg s (SI exact)");
ok(K_B_CGS === 1.380649e-16, "k_B = 1.380649e-16 erg/K (SI exact)");
// sigma_SB is DERIVABLE from them: 2 pi^5 k^4 / (15 h^3 c^2).
const sigmaDerived = (2 * Math.PI ** 5 * K_B_CGS ** 4) / (15 * PLANCK_H_CGS ** 3 * C_CM_S ** 2);
ok(
  Math.abs(sigmaDerived / SIGMA_SB_CGS - 1) < 1e-9,
  "…and sigma_SB = 2 pi^5 k^4/(15 h^3 c^2) reproduces the CODATA value",
);
ok(AU_CM === 1.495978707e13, "au = 1.495978707e13 cm (IAU 2012 B2, exact)");
// pc = 648000/pi au, exactly; the familiar 3.0856775815e18 cm.
ok(Math.abs(PC_CM / 3.085677581e18 - 1) < 1e-9, "pc = 3.085677581e18 cm (IAU 2015 B2, exact)");

/* ── 2. derived values agree with their consumers ── */
ok(Math.abs(T_SUN_K - 5772) < 0.01, "T_sun derives to the IAU nominal 5772 K");
// The cross-module invariant: core/stellar's Stefan-Boltzmann closure must be
// anchored on the SAME number. This is what a second hand-typed copy would break.
ok(
  effectiveTemperature(1, 1) === T_SUN_K,
  "core/stellar's Stefan-Boltzmann anchor IS constants.T_SUN_K (bit-for-bit)",
);

/* ── 3. nobody else declares a physical constant ── */
const BANNED = [
  { re: /\b3\.828e33\b/, what: "L_sun" },
  { re: /\b6\.957e10\b/, what: "R_sun" },
  { re: /\b5\.670374419e-5\b/, what: "sigma_SB" },
  { re: /\b1\.3271244e26\b/, what: "GM_sun" },
  { re: /\b1\.495978707e13\b/, what: "au" },
  { re: /\b2\.99792458e10\b/, what: "c" },
  { re: /\b6\.62607015e-27\b/, what: "h" },
  { re: /\b1\.380649e-16\b/, what: "k_B" },
  { re: /(?<![.\w])5772(?:\.0|\b)/, what: "T_sun" },
];

/** Blank comments so a value quoted in prose ("IAU 2015 nominal 5772 K") is not a declaration. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
};

const offenders = [];
for (const file of walk(PKG)) {
  if (resolve(file) === CONSTANTS_FILE) continue; // the one home
  const src = stripComments(readFileSync(file, "utf8"));
  for (const { re, what } of BANNED) {
    if (re.test(src)) offenders.push(`${relative(ROOT, file)} declares ${what}`);
  }
}
ok(
  offenders.length === 0,
  offenders.length === 0
    ? "no physical constant is declared outside core/constants"
    : `physical constants re-declared:\n      ${offenders.join("\n      ")}\n      -> import from @novascope/core/constants instead`,
);

process.exit(failures ? 1 : 0);
