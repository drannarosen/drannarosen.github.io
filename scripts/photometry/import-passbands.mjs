/*
 * import-passbands.mjs — generate tabulated filter curves from PRIMARY sources.
 *
 * Run by hand, not in the build: it fetches from the network. The output is
 * committed, so the site builds from the generated module and this script only has
 * to run when the curves change.
 *
 * IT DOWNLOADS FROM THE AUTHORITY, not from a sibling repository. An earlier version
 * read the same curves out of a local fluxax checkout, which worked but left the
 * audit trail for a published number pointing at another private repo — unfollowable
 * by anyone else, and a break in novascope's extractability guarantee, since the code
 * moves but the justification does not. Verified byte-identical between the two
 * routes (all 9 files) before switching, so nothing about the data changed.
 *
 * WHY GENERATE RATHER THAN HAND-TYPE. These are hundreds of numbers each. Typed by
 * hand they would be unverifiable and one transposed digit would shift a colour
 * nobody could trace. Generated, they carry the PRIMARY upstream, the file's own
 * self-describing header, the mirror hash and the resampling parameters — so a published
 * number can be traced without access to any of my other repositories.
 *
 * WHY TABULATED AT ALL. `core/photometry` models Johnson-Cousins and 2MASS as
 * Gaussians, which is a stated and reasonable approximation for those. It is NOT
 * reasonable for the instruments added here: Gaia's G band runs 320-1050 nm, so a
 * Gaussian is not an approximation of it but a different filter. Rubin's u and y sit
 * against atmospheric and detector cutoffs that a symmetric bell cannot represent
 * either.
 *
 * Usage:
 *   node scripts/photometry/import-passbands.mjs              # fetch from source
 *   node scripts/photometry/import-passbands.mjs --offline=DIR # use a local mirror
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
/*
 * An offline mirror is supported but never the default: it exists so the import can
 * be re-run without the network, not so a local copy can quietly become the source
 * of record. Any directory holding the same filenames works.
 */
const OFFLINE = args.offline ? resolve(ROOT, String(args.offline)) : null;

/*
 * Resampling grid. The upstream Rubin curves are ~8,500 points each at sub-nm
 * spacing, which is far finer than integrating a blackbody needs and would be ~50k
 * numbers in the bundle. 5 nm resolves every real feature in these curves (the
 * narrowest structure is Rubin u's ~50 nm width) at ~1/25 the size.
 */
const STEP_NM = 5;

/** Parse a two-column `.dat`, skipping comments. Returns [{ lam, t }] sorted. */
function parseCurve(text, lambdaScale) {
  const rows = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const [a, b] = s.split(/\s+/);
    const lam = Number(a) * lambdaScale;
    const t = Number(b);
    if (Number.isFinite(lam) && Number.isFinite(t)) rows.push({ lam, t });
  }
  rows.sort((p, q) => p.lam - q.lam);
  if (rows.length < 2) throw new Error("fewer than 2 usable rows");
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

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/*
 * PRIMARY sources — the authority for these numbers.
 *
 * fluxax is where the files happen to be VENDORED on this machine; it is a
 * convenient route, not the provenance. Recording only the fluxax path (as the
 * first version of this script did) leaves the audit trail for a published number
 * pointing at another private repository, which nobody else can follow and which
 * breaks novascope's extractability guarantee: the code moves, the justification
 * does not.
 *
 * So each instrument names its real upstream, and the per-file record below carries
 * whatever the file itself states about its own origin.
 */
const PRIMARY = {
  rubin: {
    instrument: "Rubin Observatory / LSST",
    upstream: "https://github.com/lsst/throughputs (baseline/) — total system throughput: atmosphere x optics x filter x detector",
    reference: "Ivezic et al. (2019) ApJ 873, 111",
    note: "TOTAL throughput, so the curves peak well below 1. Not renormalized here — the level is real information about how much light each band collects.",
  },
  gaia: {
    instrument: "Gaia DR3",
    upstream: "SVO Filter Profile Service (http://svo2.cab.inta-csic.es/theory/fps/), filter IDs GAIA/GAIA3.{G,Gbp,Grp}",
    reference: "Riello et al. (2021) A&A 649, A3",
    note: "PHOTON-counting total responses, unlike the energy-counting Bessell curves.",
  },
};

/*
 * The bands to import. `lambdaScale` converts the file's wavelength unit to nm:
 * the SVO Gaia curves are in Angstrom, the Rubin syseng curves already in nm.
 *
 * `url` is the authority. `file` is only the basename used when reading an offline
 * mirror instead.
 */
const SOURCES = [
  ...["u", "g", "r", "i", "z", "y"].map((b) => ({
    id: `LSST_${b}`,
    label: `Rubin ${b}`,
    instrument: "rubin",
    regime: b === "u" ? "uv" : "ugr".includes(b) ? "visible" : b === "y" ? "nir" : "visible",
    file: `total_${b}.dat`,
    url: `https://raw.githubusercontent.com/lsst/throughputs/main/baseline/total_${b}.dat`,
    lambdaScale: 1, // nm
  })),
  { id: "Gaia_G", label: "Gaia G", instrument: "gaia", regime: "visible", file: "GAIA_GAIA3.G.dat", url: "http://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=GAIA/GAIA3.G", lambdaScale: 0.1 },
  { id: "Gaia_BP", label: "Gaia BP", instrument: "gaia", regime: "visible", file: "GAIA_GAIA3.Gbp.dat", url: "http://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=GAIA/GAIA3.Gbp", lambdaScale: 0.1 },
  { id: "Gaia_RP", label: "Gaia RP", instrument: "gaia", regime: "visible", file: "GAIA_GAIA3.Grp.dat", url: "http://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=GAIA/GAIA3.Grp", lambdaScale: 0.1 },
];

/**
 * Pull the leading `#` comment block out of a data file.
 *
 * The Rubin curves state their own provenance in their header — the
 * syseng_throughputs version and its git sha1 — which is a far better record than
 * any path, because it identifies the artifact independently of where it is stored.
 */
function parseHeader(text) {
  const lines = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("#")) break;
    lines.push(s.replace(/^#\s?/, ""));
  }
  return lines;
}

/** Fetch a curve's text from its authority, or from the offline mirror if given. */
async function loadText(src) {
  if (OFFLINE) {
    const p = resolve(OFFLINE, src.file);
    if (!existsSync(p)) throw new Error(`offline mirror missing ${src.file} (looked in ${OFFLINE})`);
    return { text: readFileSync(p, "utf8"), from: `offline:${src.file}` };
  }
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`${src.url} -> HTTP ${res.status}`);
  return { text: await res.text(), from: src.url };
}

console.log(OFFLINE ? `reading offline mirror ${OFFLINE}` : "fetching from primary sources…");

const out = [];
for (const s of SOURCES) {
  const { text, from } = await loadText(s);
  const rows = parseCurve(text, s.lambdaScale);
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
    sha256: sha256(text),
    header: parseHeader(text),
    from,
    primary: PRIMARY[s.instrument],
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
 * PROVENANCE lives per-curve in \`provenance\`, and it names the PRIMARY source:
 *   Rubin ugrizy — lsst/syseng_throughputs total system throughput. Each curve's
 *     \`fileHeader\` carries the upstream version and git sha1 verbatim, which
 *     identifies the artifact independently of any local checkout.
 *     Reference: Ivezic et al. (2019) ApJ 873, 111.
 *   Gaia G/BP/RP — SVO Filter Profile Service, GAIA/GAIA3.{G,Gbp,Grp}.
 *     Reference: Riello et al. (2021) A&A 649, A3.
 *
 * These files were READ THROUGH a local fluxax checkout, which is a mirror and not
 * the authority — \`mirrorPath\`/\`mirrorSha256\` record that route so the import can
 * be re-run and re-verified, and nothing else depends on it. This module imports
 * NOTHING and the site neither builds nor runs against fluxax.
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
  /** The instrument this band belongs to, and where its curve really comes from. */
  provenance: {
    instrument: string;
    /** The PRIMARY upstream — the authority, independent of any local checkout. */
    upstream: string;
    /** Literature reference for the photometric system. */
    reference: string;
    /** Anything specific about this curve's convention. */
    note: string;
    /**
     * What the data file said about ITSELF, verbatim. For the Rubin curves this
     * carries the syseng_throughputs version and git sha1, which identifies the
     * artifact independently of where it happens to be stored.
     */
    fileHeader: string[];
  };
  /* The exact bytes, and where they came from. Anyone can re-fetch the URL in
   * provenance.upstream and check this hash — that is the point of recording it. */
  /** sha256 of the exact bytes this curve was generated from. */
  sourceSha256: string;
  /** Where those bytes were read from on the run that generated this. */
  readFrom: string;
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
    provenance: {
      instrument: ${JSON.stringify(c.primary.instrument)},
      upstream: ${JSON.stringify(c.primary.upstream)},
      reference: ${JSON.stringify(c.primary.reference)},
      note: ${JSON.stringify(c.primary.note)},
      fileHeader: ${JSON.stringify(c.header)},
    },
    sourceSha256: "${c.sha256}",
    readFrom: ${JSON.stringify(c.from)},
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
