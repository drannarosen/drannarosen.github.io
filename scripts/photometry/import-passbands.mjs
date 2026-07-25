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
 * WHY TABULATED AT ALL. `core/photometry` used to model Johnson-Cousins and 2MASS as
 * GAUSSIANS, on the stated grounds that a bell is a defensible model of a classical
 * broadband filter and there was no bulk data to ship. The first half of that was
 * always shaky — Rubin's u and y sit against atmospheric and detector cutoffs a
 * symmetric bell cannot represent, and Gaia's G runs 330-1050 nm, so a Gaussian is
 * not an approximation of it but a different filter. The second half stopped being
 * true once `lsst/throughputs` turned out to carry measured Johnson, Cousins, 2MASS
 * and SDSS curves alongside the Rubin ones.
 *
 * So every band is now tabulated and the Gaussian path is GONE. That is a
 * simplification, not an addition: `passbands.ts` has one response mechanism instead
 * of two, and no band carries both a curve and a nominal FWHM — two descriptions of
 * one filter, which is exactly the kind of pair that drifts.
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
 * Resampling grid. The upstream Rubin and SDSS curves are ~8,500 points each at
 * sub-nm spacing, far finer than integrating a blackbody needs and ~50k numbers in
 * the bundle if kept.
 *
 * 5 nm is the DEFAULT, not the rule, because the bands span 25x in width: Johnson U
 * covers 123 nm and JWST/MIRI F770W covers 3121 nm. One global step would either
 * under-resolve U (25 samples across a 66 nm FWHM) or bloat F770W (625 samples of a
 * smooth curve). So `stepNm` is per-band below, chosen for ~50-100 samples across the
 * band, and `check:passbands` ASSERTS that outcome for every curve. The gate is what
 * makes 21 hand-chosen numbers safe: a badly-stepped new filter fails the build
 * rather than quietly shipping a curve too coarse to integrate.
 */
const DEFAULT_STEP_NM = 5;

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
const LSST_THROUGHPUTS = "https://github.com/lsst/throughputs";
const SVO = "https://svo2.cab.inta-csic.es/theory/fps/";

const PRIMARY = {
  rubin: {
    instrument: "Rubin Observatory / LSST",
    upstream: `${LSST_THROUGHPUTS} (baseline/) — total system throughput: atmosphere x optics x filter x detector`,
    reference: "Ivezic et al. (2019) ApJ 873, 111",
    note: "TOTAL throughput, so the curves peak well below 1. Not renormalized here — the level is real information about how much light each band collects.",
  },
  gaia: {
    instrument: "Gaia DR3",
    upstream: `SVO Filter Profile Service (${SVO}), filter IDs GAIA/GAIA3.{G,Gbp,Grp}`,
    reference: "Riello et al. (2021) A&A 649, A3",
    note: "PHOTON-counting total responses.",
  },
  johnson: {
    instrument: "Johnson-Cousins (generic)",
    upstream: `${LSST_THROUGHPUTS} (johnson/) — johnson_{U,B,V}.dat and cousins_{R,I}.dat`,
    reference: "Mann & von Braun (2015) PASP 127, 102; Bessell (1990) PASP 102, 1181",
    note: "FILTER transmission normalized to a peak of 1, NOT a system throughput — no telescope, detector or atmosphere. The generic system a synthetic UBVRI colour is defined on, which is what it is used for here.",
  },
  "2mass": {
    instrument: "2MASS",
    upstream: `${LSST_THROUGHPUTS} (2MASS/) — 2MASS_{J,H,Ks}.dat, themselves from the SVO service (${SVO})`,
    reference: "Cohen, Wheaton & Megeath (2003) AJ 126, 1090",
    note: "Relative spectral response normalized to a peak of 1. The third band is Ks (2.16 um), not the older K (2.19 um) — the name in this package is K and the curve is Ks, which is the standard modern choice.",
  },
  sdss: {
    instrument: "SDSS 2.5 m",
    upstream: `${LSST_THROUGHPUTS} (sdss/) — doi_{u,g,r,i,z}.dat`,
    reference: "Doi et al. (2010) AJ 139, 1628",
    note: "As-measured total responses at 1.3 airmasses. The doi_* curves are used rather than the sdss_* Gunn curves beside them because they are the refereed, citable measurement — the Gunn files' own header points only at a retired sdss.org DR3 page.",
  },
  hst: {
    instrument: "Hubble Space Telescope",
    upstream: `SVO Filter Profile Service (${SVO}), filter IDs HST/WFC3_UVIS2.F275W, HST/ACS_WFC.F606W, HST/ACS_WFC.F814W, HST/WFC3_IR.F160W`,
    reference: "Sirianni et al. (2005) PASP 117, 1049 (ACS); Dressel (2023) WFC3 Instrument Handbook",
    note: "TOTAL system throughput including optics and detector, so peaks run 0.13-0.55. No atmosphere, because there is none — which is why HST reaches the near-UV at all.",
  },
  jwst: {
    instrument: "James Webb Space Telescope",
    upstream: `SVO Filter Profile Service (${SVO}), filter IDs JWST/NIRCam.F090W, JWST/NIRCam.F200W, JWST/NIRCam.F444W, JWST/MIRI.F770W`,
    reference: "Rieke et al. (2023) PASP 135, 028001 (NIRCam); Wright et al. (2023) PASP 135, 048003 (MIRI)",
    note: "TOTAL system throughput. F770W reaches 7.7 um, extending the baseline here by nearly a decade in wavelength — the regime where embedded and heavily reddened stars are actually observed.",
  },
};

/*
 * The bands to import.
 *
 * `lambdaScale` converts the file's wavelength unit to nm: SVO serves Angstrom, the
 * lsst/throughputs files are already nm. `stepNm` overrides the default resampling
 * grid where a band's width calls for it (see DEFAULT_STEP_NM). `url` is the
 * authority; `file` is only the basename used when reading an offline mirror.
 *
 * `id` is the name the rest of the package uses. The classical bands keep their bare
 * ids — U, B, V, R, I, J, H, K — because those ARE the band names and because
 * `BAND_COMPOSITES` and the lab page reference them; what changed is that each now
 * carries a measured curve instead of a bell.
 */
const gh = (dir, file) => `https://raw.githubusercontent.com/lsst/throughputs/main/${dir}/${file}`;
const svo = (id) => `${SVO}getdata.php?format=ascii&id=${id}`;

const SOURCES = [
  /* ── Rubin/LSST: total system throughput, the reference survey here ── */
  ...["u", "g", "r", "i", "z", "y"].map((b) => ({
    id: `LSST_${b}`,
    label: `Rubin ${b}`,
    instrument: "rubin",
    regime: b === "u" ? "uv" : b === "y" || b === "z" ? "nir" : "visible",
    file: `total_${b}.dat`,
    url: gh("baseline", `total_${b}.dat`),
    lambdaScale: 1,
  })),

  /* ── Gaia DR3 ── */
  { id: "Gaia_G", label: "Gaia G", instrument: "gaia", regime: "visible", file: "GAIA_GAIA3.G.dat", url: svo("GAIA/GAIA3.G"), lambdaScale: 0.1 },
  { id: "Gaia_BP", label: "Gaia BP", instrument: "gaia", regime: "visible", file: "GAIA_GAIA3.Gbp.dat", url: svo("GAIA/GAIA3.Gbp"), lambdaScale: 0.1 },
  { id: "Gaia_RP", label: "Gaia RP", instrument: "gaia", regime: "visible", file: "GAIA_GAIA3.Grp.dat", url: svo("GAIA/GAIA3.Grp"), lambdaScale: 0.1 },

  /* ── Johnson-Cousins UBVRI. Narrow bands, so a finer grid for U and B. ── */
  { id: "U", label: "Johnson U", instrument: "johnson", regime: "uv", file: "johnson_U.dat", url: gh("johnson", "johnson_U.dat"), lambdaScale: 1, stepNm: 2 },
  { id: "B", label: "Johnson B", instrument: "johnson", regime: "visible", file: "johnson_B.dat", url: gh("johnson", "johnson_B.dat"), lambdaScale: 1, stepNm: 2.5 },
  { id: "V", label: "Johnson V", instrument: "johnson", regime: "visible", file: "johnson_V.dat", url: gh("johnson", "johnson_V.dat"), lambdaScale: 1 },
  { id: "R", label: "Cousins R", instrument: "johnson", regime: "visible", file: "cousins_R.dat", url: gh("johnson", "cousins_R.dat"), lambdaScale: 1 },
  { id: "I", label: "Cousins I", instrument: "johnson", regime: "nir", file: "cousins_I.dat", url: gh("johnson", "cousins_I.dat"), lambdaScale: 1, stepNm: 2.5 },

  /* ── 2MASS JHKs ── */
  { id: "J", label: "2MASS J", instrument: "2mass", regime: "nir", file: "2MASS_J.dat", url: gh("2MASS", "2MASS_J.dat"), lambdaScale: 1 },
  { id: "H", label: "2MASS H", instrument: "2mass", regime: "nir", file: "2MASS_H.dat", url: gh("2MASS", "2MASS_H.dat"), lambdaScale: 1 },
  { id: "K", label: "2MASS Ks", instrument: "2mass", regime: "nir", file: "2MASS_Ks.dat", url: gh("2MASS", "2MASS_Ks.dat"), lambdaScale: 1 },

  /* ── SDSS ugriz — Rubin's direct ancestor, and the AB system's home survey ── */
  { id: "SDSS_u", label: "SDSS u", instrument: "sdss", regime: "uv", file: "doi_u.dat", url: gh("sdss", "doi_u.dat"), lambdaScale: 1 },
  { id: "SDSS_g", label: "SDSS g", instrument: "sdss", regime: "visible", file: "doi_g.dat", url: gh("sdss", "doi_g.dat"), lambdaScale: 1, stepNm: 2.5 },
  { id: "SDSS_r", label: "SDSS r", instrument: "sdss", regime: "visible", file: "doi_r.dat", url: gh("sdss", "doi_r.dat"), lambdaScale: 1, stepNm: 2 },
  { id: "SDSS_i", label: "SDSS i", instrument: "sdss", regime: "visible", file: "doi_i.dat", url: gh("sdss", "doi_i.dat"), lambdaScale: 1, stepNm: 2 },
  { id: "SDSS_z", label: "SDSS z", instrument: "sdss", regime: "nir", file: "doi_z.dat", url: gh("sdss", "doi_z.dat"), lambdaScale: 1 },

  /* ── HST. F275W is the only near-UV band in the package: no atmosphere. ── */
  { id: "HST_F275W", label: "HST F275W", instrument: "hst", regime: "uv", file: "HST_WFC3_UVIS2.F275W.dat", url: svo("HST/WFC3_UVIS2.F275W"), lambdaScale: 0.1, stepNm: 1 },
  { id: "HST_F606W", label: "HST F606W", instrument: "hst", regime: "visible", file: "HST_ACS_WFC.F606W.dat", url: svo("HST/ACS_WFC.F606W"), lambdaScale: 0.1 },
  { id: "HST_F814W", label: "HST F814W", instrument: "hst", regime: "nir", file: "HST_ACS_WFC.F814W.dat", url: svo("HST/ACS_WFC.F814W"), lambdaScale: 0.1 },
  { id: "HST_F160W", label: "HST F160W", instrument: "hst", regime: "nir", file: "HST_WFC3_IR.F160W.dat", url: svo("HST/WFC3_IR.F160W"), lambdaScale: 0.1 },

  /* ── JWST. Coarser grids: these are wide and smooth, and F770W spans 3 um. ── */
  { id: "JWST_F090W", label: "JWST F090W", instrument: "jwst", regime: "nir", file: "JWST_NIRCam.F090W.dat", url: svo("JWST/NIRCam.F090W"), lambdaScale: 0.1 },
  { id: "JWST_F200W", label: "JWST F200W", instrument: "jwst", regime: "nir", file: "JWST_NIRCam.F200W.dat", url: svo("JWST/NIRCam.F200W"), lambdaScale: 0.1, stepNm: 10 },
  { id: "JWST_F444W", label: "JWST F444W", instrument: "jwst", regime: "nir", file: "JWST_NIRCam.F444W.dat", url: svo("JWST/NIRCam.F444W"), lambdaScale: 0.1, stepNm: 20 },
  { id: "JWST_F770W", label: "JWST F770W", instrument: "jwst", regime: "mir", file: "JWST_MIRI.F770W.dat", url: svo("JWST/MIRI.F770W"), lambdaScale: 0.1, stepNm: 40 },
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
  const step = s.stepNm ?? DEFAULT_STEP_NM;
  const curve = resample(rows, step);
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
  /*
   * The SAME quantity computed from the RAW source rows, before resampling.
   *
   * Recorded so the gate can separate two questions that comparing against a
   * published table conflates: did the resampling distort this band, and is this the
   * same filter someone else published? The first is answerable offline and is a real
   * check on this script; the second is not a defect when it fails. Johnson U is
   * exactly that case — it reproduces its own source to 0.0% while sitting 2.5% from
   * SVO's Generic/Johnson.U, because Mann & von Braun's U spans 296-419 nm and SVO's
   * spans 310-410 nm. Two different U curves, not a broken import.
   *
   * TRAPEZOIDAL, not a plain average of the rows. The raw curves are not uniformly
   * spaced — the 2MASS files sample densely where the transmission turns over — so
   * sum(lam*t)/sum(t) over the rows is not an integral, and it lands 1.2% high for
   * Ks and disagrees with SVO's published mean by 1.5%. The resampled curve, on a
   * uniform grid, was the right answer all along; the naive comparison was the wrong
   * yardstick. Weighting each row by its neighbour spacing removes that bias and both
   * then agree to 0.01%.
   */
  let rnum = 0;
  let rden = 0;
  for (let i = 0; i < rows.length; i++) {
    const prev = rows[Math.max(0, i - 1)];
    const next = rows[Math.min(rows.length - 1, i + 1)];
    const w = (next.lam - prev.lam) / 2;
    rnum += rows[i].lam * rows[i].t * w;
    rden += rows[i].t * w;
  }
  out.push({
    ...s,
    sha256: sha256(text),
    header: parseHeader(text),
    from,
    primary: PRIMARY[s.instrument],
    lambdaEffNm: num / den,
    sourceLambdaEffNm: rnum / rden,
    peak,
    ...curve,
  });
  // Half-maximum width, derived here only to REPORT it — the gate re-derives its own.
  const half = peak / 2;
  const above = curve.values.map((v, i) => (v >= half ? i : -1)).filter((i) => i >= 0);
  const fwhm = above.length ? (above[above.length - 1] - above[0] + 1) * curve.stepNm : 0;
  console.log(
    `  ${s.id.padEnd(10)} ${rows.length.toString().padStart(5)} pts -> ${curve.values.length.toString().padStart(4)} @ ${String(step).padStart(4)}nm` +
      `  lam_eff ${(num / den).toFixed(1).padStart(7)} nm  peak ${peak.toFixed(3)}` +
      `  fwhm ${fwhm.toFixed(0).padStart(4)} nm (${(fwhm / curve.stepNm).toFixed(0)} samples)`,
  );
}

const num = (v) => Number(v.toPrecision(6));
const body = `/*
 * passbandCurves.ts — GENERATED. Do not edit by hand.
 *
 * Measured filter response curves for every band this package knows, written by
 * \`scripts/photometry/import-passbands.mjs\` from PRIMARY sources and resampled onto a
 * uniform per-band grid by bin AVERAGING — which preserves the band integral, unlike
 * point sampling.
 *
 * ${out.length} curves, ${out.reduce((n, c) => n + c.values.length, 0)} samples:
 *   Johnson UBV + Cousins RI — lsst/throughputs johnson/. FILTER transmission only
 *     (no telescope, detector or atmosphere), normalized to a peak of 1.
 *     Mann & von Braun (2015) PASP 127, 102; Bessell (1990) PASP 102, 1181.
 *   2MASS J/H/Ks — lsst/throughputs 2MASS/. Cohen et al. (2003) AJ 126, 1090.
 *   SDSS ugriz — lsst/throughputs sdss/, the doi_* as-measured curves.
 *     Doi et al. (2010) AJ 139, 1628.
 *   Rubin ugrizy — lsst/throughputs baseline/, TOTAL system throughput (atmosphere x
 *     optics x filter x detector). Each curve's \`fileHeader\` carries the upstream
 *     syseng_throughputs version and git sha1 verbatim, which identifies the artifact
 *     independently of any local checkout. Ivezic et al. (2019) ApJ 873, 111.
 *   Gaia DR3 G/BP/RP — SVO Filter Profile Service. Riello et al. (2021) A&A 649, A3.
 *   HST F275W/F606W/F814W/F160W — SVO. Total throughput, no atmosphere.
 *   JWST F090W/F200W/F444W/F770W — SVO. F770W reaches 7.7 um.
 *
 * EVERY BAND IS TABULATED. There is no Gaussian fallback: \`passbands.ts\` used to model
 * Johnson-Cousins and 2MASS as bells because there was no bulk data to ship, and
 * lsst/throughputs turned out to carry measured curves for those too. One response
 * mechanism, and no band carrying both a curve and a disagreeing nominal FWHM.
 *
 * \`stepNm\` is PER CURVE. The bands span 25x in width (Johnson U covers 123 nm, MIRI
 * F770W covers 3121 nm), so one global step would either under-resolve the narrow
 * bands or store hundreds of redundant samples of the wide ones. Every curve lands at
 * ~50-110 samples, and \`pnpm check:passbands\` asserts that rather than trusting it.
 *
 * \`lambdaEffNm\` is DERIVED from each curve here (transmission-weighted mean), not
 * copied from a published table, so it cannot disagree with the data beside it. The
 * gate re-derives it independently and also compares it against published values.
 *
 * \`sourceSha256\` pins the exact upstream bytes and \`provenance.upstream\` names a
 * fetchable authority — never one of my own repositories. An earlier version of the
 * importer read these curves out of a local fluxax checkout, which worked but left the
 * audit trail for a published number pointing somewhere nobody else could follow.
 * This module imports NOTHING and the site neither builds nor runs against fluxax.
 */

export interface TabulatedCurve {
  id: string;
  label: string;
  /** Which regime it samples — for grouping in a UI. \`mir\` is JWST/MIRI only. */
  regime: "uv" | "visible" | "nir" | "mir";
  /** Wavelength of \`values[0]\` [nm]. */
  startNm: number;
  /** Uniform grid spacing [nm]. */
  stepNm: number;
  /** Transmission, in the upstream file's own normalization (not forced to 1). */
  values: number[];
  /** Transmission-weighted mean wavelength [nm], derived from \`values\`. */
  lambdaEffNm: number;
  /**
   * The same mean computed from the RAW source rows, before resampling.
   *
   * Exists so \`check:passbands\` can gate the RESAMPLING offline — the two must agree
   * to a fraction of a percent — separately from whether this filter matches someone
   * else's curve of the same name, which is not a defect when it differs.
   */
  sourceLambdaEffNm: number;
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

/** The grid a band gets unless its width called for something finer or coarser. */
export const DEFAULT_RESAMPLE_STEP_NM = ${DEFAULT_STEP_NM};

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
    sourceLambdaEffNm: ${num(c.sourceLambdaEffNm)},
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
