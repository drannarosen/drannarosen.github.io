/*
 * import-passbands.mjs — generate tabulated filter curves from fluxax's data.
 *
 * Run by hand, not in the build: it reads out of a SIBLING repository
 * (`../jaxstro-dev/fluxax`) that this site does not depend on and cannot assume is
 * present. The output is committed, so the site builds from the generated module
 * and the generator only has to exist when the curves change.
 *
 * WHY GENERATE RATHER THAN HAND-TYPE. These are hundreds of numbers each. Typed by
 * hand they would be unverifiable and one transposed digit would shift a colour
 * nobody could trace. Generated, they carry the source path, the upstream sha256
 * and the resampling parameters, so `check:passbands` can prove the committed
 * module still matches the file it came from.
 *
 * WHY TABULATED AT ALL. `core/photometry` models Johnson-Cousins and 2MASS as
 * Gaussians, which is a stated and reasonable approximation for those. It is NOT
 * reasonable for the instruments added here: Gaia's G band runs 320-1050 nm, so a
 * Gaussian is not an approximation of it but a different filter. Rubin's u and y sit
 * against atmospheric and detector cutoffs that a symmetric bell cannot represent
 * either.
 *
 * Usage:  node scripts/photometry/import-passbands.mjs [--fluxax=PATH]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const FLUXAX = resolve(ROOT, String(args.fluxax ?? "../jaxstro-dev/fluxax"));

/*
 * Resampling grid. The upstream Rubin curves are ~8,500 points each at sub-nm
 * spacing, which is far finer than integrating a blackbody needs and would be ~50k
 * numbers in the bundle. 5 nm resolves every real feature in these curves (the
 * narrowest structure is Rubin u's ~50 nm width) at ~1/25 the size.
 */
const STEP_NM = 5;

/** Parse a two-column `.dat`, skipping comments. Returns [{ lam, t }] sorted. */
function readCurve(path, lambdaScale) {
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const [a, b] = s.split(/\s+/);
    const lam = Number(a) * lambdaScale;
    const t = Number(b);
    if (Number.isFinite(lam) && Number.isFinite(t)) rows.push({ lam, t });
  }
  rows.sort((p, q) => p.lam - q.lam);
  if (rows.length < 2) throw new Error(`${path}: fewer than 2 usable rows`);
  return rows;
}

/**
 * Resample onto a uniform grid by trapezoidal AVERAGING over each output bin, not
 * by point sampling.
 *
 * Point sampling a 0.1 nm curve at 5 nm throws away 98% of it and can land on a
 * spike or a zero; averaging preserves the band integral, which is the only thing
 * the consumer computes. Retains the grid start/step so the module stores values
 * alone rather than pairs.
 */
function resample(rows, stepNm) {
  const lo = Math.floor(rows[0].lam / stepNm) * stepNm;
  const hi = Math.ceil(rows[rows.length - 1].lam / stepNm) * stepNm;
  const at = (lam) => {
    // linear interpolation on the source grid
    if (lam <= rows[0].lam || lam >= rows[rows.length - 1].lam) return 0;
    let i = 0;
    let j = rows.length - 1;
    while (j - i > 1) {
      const m = (i + j) >> 1;
      if (rows[m].lam <= lam) i = m;
      else j = m;
    }
    const f = (lam - rows[i].lam) / (rows[j].lam - rows[i].lam);
    return rows[i].t + f * (rows[j].t - rows[i].t);
  };
  const values = [];
  const SUB = 8; // sub-samples per output bin, for the average
  for (let lam = lo; lam <= hi + 1e-9; lam += stepNm) {
    let acc = 0;
    for (let k = 0; k < SUB; k++) acc += at(lam + ((k + 0.5) / SUB - 0.5) * stepNm);
    values.push(acc / SUB);
  }
  // Trim leading/trailing zeros so a wide-but-empty grid is not stored.
  let a = 0;
  let b = values.length - 1;
  while (a < b && values[a] === 0) a++;
  while (b > a && values[b] === 0) b--;
  return { startNm: lo + a * stepNm, stepNm, values: values.slice(a, b + 1) };
}

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/*
 * The bands to import. `lambdaScale` converts the file's wavelength unit to nm:
 * the SVO Gaia curves are in Angstrom, the Rubin syseng curves already in nm.
 */
const SOURCES = [
  ...["u", "g", "r", "i", "z", "y"].map((b) => ({
    id: `LSST_${b}`,
    label: `Rubin ${b}`,
    regime: b === "u" ? "uv" : "ugr".includes(b) ? "visible" : b === "y" ? "nir" : "visible",
    file: `src/fluxax/instruments/rubin/data/total_${b}.dat`,
    lambdaScale: 1, // nm
  })),
  { id: "Gaia_G", label: "Gaia G", regime: "visible", file: "src/fluxax/instruments/gaia/data/GAIA_GAIA3.G.dat", lambdaScale: 0.1 },
  { id: "Gaia_BP", label: "Gaia BP", regime: "visible", file: "src/fluxax/instruments/gaia/data/GAIA_GAIA3.Gbp.dat", lambdaScale: 0.1 },
  { id: "Gaia_RP", label: "Gaia RP", regime: "visible", file: "src/fluxax/instruments/gaia/data/GAIA_GAIA3.Grp.dat", lambdaScale: 0.1 },
];

if (!existsSync(FLUXAX)) {
  console.error(`✗ fluxax not found at ${FLUXAX}\n  pass --fluxax=PATH`);
  process.exit(1);
}

const out = [];
for (const s of SOURCES) {
  const path = resolve(FLUXAX, s.file);
  if (!existsSync(path)) {
    console.error(`✗ missing source: ${path}`);
    process.exit(1);
  }
  const rows = readCurve(path, s.lambdaScale);
  const curve = resample(rows, STEP_NM);
  const peak = Math.max(...curve.values);
  // Effective wavelength, transmission-weighted — DERIVED from the curve rather
  // than copied from a table, so it cannot disagree with the data beside it.
  let num = 0;
  let den = 0;
  for (let i = 0; i < curve.values.length; i++) {
    const lam = curve.startNm + i * curve.stepNm;
    num += lam * curve.values[i];
    den += curve.values[i];
  }
  out.push({
    ...s,
    sha256: sha256(path),
    lambdaEffNm: num / den,
    peak,
    ...curve,
  });
  console.log(
    `  ${s.id.padEnd(8)} ${rows.length.toString().padStart(5)} pts -> ${curve.values.length.toString().padStart(4)} @ ${STEP_NM}nm` +
      `  lam_eff ${(num / den).toFixed(1)} nm  peak ${peak.toFixed(3)}`,
  );
}

const num = (v) => Number(v.toPrecision(6));
const body = `/*
 * passbandCurves.ts — GENERATED. Do not edit by hand.
 *
 * Tabulated filter response curves for Rubin/LSST ugrizy and Gaia DR3 G/BP/RP,
 * imported from the fluxax package by \`scripts/photometry/import-passbands.mjs\`
 * and resampled to a uniform ${STEP_NM} nm grid by bin AVERAGING (which preserves the band
 * integral, unlike point sampling).
 *
 * These are REAL measured curves, not the Gaussian approximation \`passbands.ts\`
 * uses for Johnson-Cousins and 2MASS. That distinction matters most for Gaia G,
 * which spans ~330-1050 nm: a Gaussian is not an approximation of it but a
 * different filter.
 *
 * PROVENANCE
 *   Rubin ugrizy — LSST system throughput (atmosphere x optics x filter x detector),
 *     from the syseng_throughputs curves shipped with fluxax. Authority:
 *     Ivezic et al. (2019) ApJ 873, 111.
 *   Gaia G/BP/RP — SVO Filter Profile Service GAIA/GAIA3.{G,Gbp,Grp}. Authority:
 *     Riello et al. (2021) A&A 649, A3 (the Gaia DR3 photometric system).
 *     PHOTON-counting passbands, unlike the energy-counting Bessell curves.
 *
 * \`lambdaEffNm\` is DERIVED from each curve here (transmission-weighted mean), not
 * copied from a published table, so it cannot disagree with the data beside it.
 * \`sourceSha256\` pins the upstream file; \`pnpm check:passbands\` re-derives every
 * curve and fails if the committed values drift from their source.
 */

export interface TabulatedCurve {
  id: string;
  label: string;
  regime: "uv" | "visible" | "nir";
  /** Wavelength of \`values[0]\` [nm]. */
  startNm: number;
  /** Uniform grid spacing [nm]. */
  stepNm: number;
  /** Transmission, in the upstream file's own normalization (not forced to 1). */
  values: number[];
  /** Transmission-weighted mean wavelength [nm], derived from \`values\`. */
  lambdaEffNm: number;
  /** sha256 of the upstream data file this was generated from. */
  sourceSha256: string;
  /** Path of the upstream file, relative to the fluxax package root. */
  sourcePath: string;
}

export const RESAMPLE_STEP_NM = ${STEP_NM};

export const TABULATED_CURVES: Record<string, TabulatedCurve> = {
${out
  .map(
    (c) => `  ${c.id}: {
    id: "${c.id}",
    label: "${c.label}",
    regime: "${c.regime}",
    startNm: ${num(c.startNm)},
    stepNm: ${num(c.stepNm)},
    lambdaEffNm: ${num(c.lambdaEffNm)},
    sourceSha256: "${c.sha256}",
    sourcePath: "${c.file}",
    values: [${c.values.map((v) => num(v)).join(", ")}],
  },`,
  )
  .join("\n")}
};
`;

const target = resolve(ROOT, "src/novascope/core/photometry/passbandCurves.ts");
writeFileSync(target, body);
console.log(
  `\n✓ wrote ${relative(ROOT, target)} — ${out.length} curves, ${out.reduce((n, c) => n + c.values.length, 0)} samples`,
);
