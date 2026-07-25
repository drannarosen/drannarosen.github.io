/*
 * passbandCurves.ts — GENERATED. Do not edit by hand.
 *
 * Measured filter response curves for every band this package knows, written by
 * `scripts/photometry/import-passbands.mjs` from PRIMARY sources and resampled onto a
 * uniform per-band grid by bin AVERAGING — which preserves the band integral, unlike
 * point sampling.
 *
 * 30 curves, 2859 samples:
 *   Johnson UBV + Cousins RI — lsst/throughputs johnson/. FILTER transmission only
 *     (no telescope, detector or atmosphere), normalized to a peak of 1.
 *     Mann & von Braun (2015) PASP 127, 102; Bessell (1990) PASP 102, 1181.
 *   2MASS J/H/Ks — lsst/throughputs 2MASS/. Cohen et al. (2003) AJ 126, 1090.
 *   SDSS ugriz — lsst/throughputs sdss/, the doi_* as-measured curves.
 *     Doi et al. (2010) AJ 139, 1628.
 *   Rubin ugrizy — lsst/throughputs baseline/, TOTAL system throughput (atmosphere x
 *     optics x filter x detector). Each curve's `fileHeader` carries the upstream
 *     syseng_throughputs version and git sha1 verbatim, which identifies the artifact
 *     independently of any local checkout. Ivezic et al. (2019) ApJ 873, 111.
 *   Gaia DR3 G/BP/RP — SVO Filter Profile Service. Riello et al. (2021) A&A 649, A3.
 *   HST F275W/F606W/F814W/F160W — SVO. Total throughput, no atmosphere.
 *   JWST F090W/F200W/F444W/F770W — SVO. F770W reaches 7.7 um.
 *
 * EVERY BAND IS TABULATED. There is no Gaussian fallback: `passbands.ts` used to model
 * Johnson-Cousins and 2MASS as bells because there was no bulk data to ship, and
 * lsst/throughputs turned out to carry measured curves for those too. One response
 * mechanism, and no band carrying both a curve and a disagreeing nominal FWHM.
 *
 * `stepNm` is PER CURVE. The bands span 25x in width (Johnson U covers 123 nm, MIRI
 * F770W covers 3121 nm), so one global step would either under-resolve the narrow
 * bands or store hundreds of redundant samples of the wide ones. Every curve lands at
 * ~50-110 samples, and `pnpm check:passbands` asserts that rather than trusting it.
 *
 * `lambdaEffNm` is DERIVED from each curve here (transmission-weighted mean), not
 * copied from a published table, so it cannot disagree with the data beside it. The
 * gate re-derives it independently and also compares it against published values.
 *
 * `sourceSha256` pins the exact upstream bytes and `provenance.upstream` names a
 * fetchable authority — never one of my own repositories. An earlier version of the
 * importer read these curves out of a local fluxax checkout, which worked but left the
 * audit trail for a published number pointing somewhere nobody else could follow.
 * This module imports NOTHING and the site neither builds nor runs against fluxax.
 */

export interface TabulatedCurve {
  id: string;
  label: string;
  /** Which regime it samples — for grouping in a UI. `mir` is JWST/MIRI only. */
  regime: "uv" | "visible" | "nir" | "mir";
  /** Wavelength of `values[0]` [nm]. */
  startNm: number;
  /** Uniform grid spacing [nm]. */
  stepNm: number;
  /** Transmission, in the upstream file's own normalization (not forced to 1). */
  values: number[];
  /** Transmission-weighted mean wavelength [nm], derived from `values`. */
  lambdaEffNm: number;
  /**
   * The same mean computed from the RAW source rows, before resampling.
   *
   * Exists so `check:passbands` can gate the RESAMPLING offline — the two must agree
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
export const DEFAULT_RESAMPLE_STEP_NM = 5;

export const TABULATED_CURVES: Record<string, TabulatedCurve> = {
  LSST_u: {
    id: "LSST_u",
    label: "Rubin u",
    regime: "uv",
    startNm: 320,
    stepNm: 5,
    lambdaEffNm: 372.356,
    sourceLambdaEffNm: 372.355,
    provenance: {
      instrument: "Rubin Observatory / LSST",
      upstream: "https://github.com/lsst/throughputs (baseline/) — total system throughput: atmosphere x optics x filter x detector",
      reference: "Ivezic et al. (2019) ApJ 873, 111",
      note: "TOTAL throughput, so the curves peak well below 1. Not renormalized here — the level is real information about how much light each band collects.",
      fileHeader: ["LSST Throughputs files created from syseng_throughputs repo","Version 1.9","sha1 fcc05772f99427e4a45cd1b9da1628dded9a06d5","Aerosols added to atmosphere","Wavelen_cutoff_BLUE 304.30","Wavelen_cutoff_RED 403.50","Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "d8fb220fed913551eb1ae5744a49e145d62aa2fd97786b515f30d20e13223b37",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/baseline/total_u.dat",
    values: [0.00000221817, 0.000523046, 0.00708309, 0.0253278, 0.0498069, 0.0723658, 0.0929061, 0.108248, 0.121045, 0.136164, 0.151239, 0.167698, 0.179281, 0.172621, 0.143085, 0.0963272, 0.0303406, 0.000780963, 0.000226766, 0, 0, 0.0000233977, 0.0000395519, 0.0000406629, 0.0000416557, 0.0000425655, 0.0000434282, 0.0000441789, 0.0000448254, 0.0000454101, 0.0000460092, 0.0000465121, 0.0000468866, 0.0000473165, 0.0000476626, 0.0000479772, 0.0000481974, 0.0000482619, 0.0000485829, 0.0000488816, 0.0000490873, 0.0000491869, 0.0000492854, 0.0000495027, 0.0000497679, 0.000049902, 0.0000501523, 0.0000503869, 0.0000505412, 0.0000506517, 0.0000508073, 0.0000511934, 0.0000516584, 0.0000520699, 0.0000520071, 0.0000523718, 0.000052893, 0.0000534107, 0.0000541119, 0.0000547556, 0.0000553053, 0.000055807, 0.0000556987, 0.0000568611, 0.000057438, 0.0000578, 0.0000580462, 0.0000586493, 0.0000592975, 0.0000598124, 0.0000601896, 0.0000605924, 0.0000609643, 0.0000592034, 0.0000551256, 0.0000606378, 0.0000613847, 0.0000618884, 0.0000622984, 0.0000619162, 0.0000586468, 0.0000592535, 0.0000601333, 0.0000621923, 0.0000627309, 0.0000629585, 0.0000630463, 0.0000631488, 0.0000438594, 0.0000463421, 0.0000622695, 0.000063329, 0.0000633734, 0.000063356, 0.0000630229, 0.000063139, 0.0000631602, 0.0000632819, 0.0000631708, 0.0000601207, 0.0000603225, 0.0000604788, 0.0000612236, 0.0000628024, 0.0000632455, 0.0000632017, 0.000063066, 0.0000628154, 0.0000626438, 0.0000623053, 0.0000619427, 0.0000612348, 0.00006065, 0.0000601798, 0.0000595871, 0.0000563521, 0.0000519803, 0.0000534669, 0.0000502879, 0.0000489663, 0.0000497267, 0.0000487161, 0.000039613, 0.000027554, 0.0000327911, 0.0000293915, 0.0000302889, 0.000029927, 0.0000305435, 0.0000308953, 0.0000321259, 0.0000292425, 0.0000283829, 0.0000273558, 0.0000256043, 0.000023641, 0.000021682, 0.0000197528, 0.0000178495, 0.0000160909, 0.0000143711, 0.0000126634, 0.0000106525, 0.00000880797, 0.00000718187, 0.00000573865, 0.00000447964, 0.00000341003, 0.00000252711, 0.00000183797, 0.0000013393, 0.00000100494, 7.39635e-7, 5.16918e-7, 3.41408e-7, 2.05491e-7, 3.59349e-8],
  },
  LSST_g: {
    id: "LSST_g",
    label: "Rubin g",
    regime: "visible",
    startNm: 320,
    stepNm: 5,
    lambdaEffNm: 480.687,
    sourceLambdaEffNm: 480.688,
    provenance: {
      instrument: "Rubin Observatory / LSST",
      upstream: "https://github.com/lsst/throughputs (baseline/) — total system throughput: atmosphere x optics x filter x detector",
      reference: "Ivezic et al. (2019) ApJ 873, 111",
      note: "TOTAL throughput, so the curves peak well below 1. Not renormalized here — the level is real information about how much light each band collects.",
      fileHeader: ["LSST Throughputs files created from syseng_throughputs repo","Version 1.9","sha1 fcc05772f99427e4a45cd1b9da1628dded9a06d5","Aerosols added to atmosphere","Wavelen_cutoff_BLUE 385.60","Wavelen_cutoff_RED 566.30","Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "f8935b3a5514e436aea45895369f568bfcc57a682852b0abe3292fd754a7094f",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/baseline/total_g.dat",
    values: [3.75859e-10, 7.07542e-8, 8.92213e-7, 0.00000312834, 0.00000597518, 0.00000853459, 0.0000108294, 0.0000126234, 0.0000142591, 0.0000159275, 0.0000176608, 0.0000194528, 0.0000213675, 0.000874557, 0.00795514, 0.0547584, 0.171577, 0.278323, 0.31533, 0.331708, 0.352519, 0.368261, 0.379643, 0.390969, 0.401283, 0.40913, 0.418348, 0.429032, 0.436672, 0.442312, 0.447399, 0.451849, 0.456747, 0.462485, 0.466559, 0.469169, 0.469745, 0.469799, 0.472649, 0.475807, 0.47863, 0.480108, 0.481967, 0.478994, 0.44318, 0.358138, 0.26253, 0.175697, 0.0701593, 0.00841629, 0.000480966, 0.00015572, 0.000210079, 0.0000635155, 0.000048747, 0.0000756877, 0.0000760223, 0.0000534107, 0.0000541119, 0.0000547556, 0.0000553053, 0.000055807, 0.0000556987, 0.0000568611, 0.000057438, 0.0000578, 0.0000580462, 0.0000586493, 0.0000592975, 0.0000598124, 0.0000601896, 0.0000605924, 0.0000609643, 0.0000592034, 0.0000551256, 0.0000606378, 0.0000613847, 0.0000618884, 0.0000622984, 0.0000619162, 0.0000586468, 0.0000592535, 0.0000601333, 0.0000621923, 0.0000627309, 0.0000629585, 0.0000630463, 0.0000631488, 0.0000438594, 0.0000463421, 0.0000622695, 0.000063329, 0.0000633734, 0.000063356, 0.0000630229, 0.000063139, 0.0000631602, 0.0000632819, 0.0000631708, 0.0000601207, 0.0000603225, 0.0000604788, 0.0000612236, 0.0000628024, 0.0000632455, 0.0000632017, 0.000063066, 0.0000628154, 0.0000626438, 0.0000623053, 0.0000619427, 0.0000612348, 0.00006065, 0.0000601798, 0.0000595871, 0.0000563521, 0.0000519803, 0.0000534669, 0.0000502879, 0.0000489663, 0.0000497267, 0.0000487161, 0.000039613, 0.000027554, 0.0000327911, 0.0000293915, 0.0000302889, 0.000029927, 0.0000305435, 0.0000308953, 0.0000321259, 0.0000292425, 0.0000283829, 0.0000273558, 0.0000256043, 0.000023641, 0.000021682, 0.0000197528, 0.0000178495, 0.0000160909, 0.0000143711, 0.0000126634, 0.0000106525, 0.00000880797, 0.00000718187, 0.00000573865, 0.00000447964, 0.00000341003, 0.00000252711, 0.00000183797, 0.0000013393, 0.00000100494, 7.39635e-7, 5.16918e-7, 3.41408e-7, 2.05491e-7, 3.59349e-8],
  },
  LSST_r: {
    id: "LSST_r",
    label: "Rubin r",
    regime: "visible",
    startNm: 320,
    stepNm: 5,
    lambdaEffNm: 622.149,
    sourceLambdaEffNm: 622.147,
    provenance: {
      instrument: "Rubin Observatory / LSST",
      upstream: "https://github.com/lsst/throughputs (baseline/) — total system throughput: atmosphere x optics x filter x detector",
      reference: "Ivezic et al. (2019) ApJ 873, 111",
      note: "TOTAL throughput, so the curves peak well below 1. Not renormalized here — the level is real information about how much light each band collects.",
      fileHeader: ["LSST Throughputs files created from syseng_throughputs repo","Version 1.9","sha1 fcc05772f99427e4a45cd1b9da1628dded9a06d5","Aerosols added to atmosphere","Wavelen_cutoff_BLUE 533.70","Wavelen_cutoff_RED 705.70","Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "7c2e6d39c57b8d36f664caf1087320af76cd098c382ccb5214e2830096f9a311",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/baseline/total_r.dat",
    values: [4.72316e-10, 7.57243e-8, 9.10081e-7, 0.00000207995, 0.00000272936, 0.0000032718, 0.00000367315, 0.0000047413, 0.00000594207, 0.0000047053, 0.00000569084, 0.00000611857, 0.00000487605, 0.00000925955, 0.00000579609, 0.00000355732, 0.0000032848, 0.00000383408, 0.00000435361, 0.00000462382, 0.00000996548, 0.000062316, 0.0000551755, 0.0000127822, 0.00000523442, 0.00000557749, 0.00000891998, 0.0000062142, 0.0000055335, 0.0000219183, 0.0000245293, 0.00000578914, 0.00000356307, 0.00000333406, 0.00000398535, 0.00000476897, 0.00000612191, 0.0000140737, 0.0000262217, 0.0000152045, 0.000281423, 0.00052395, 0.000948667, 0.00524003, 0.0376869, 0.132154, 0.289858, 0.410147, 0.469477, 0.483624, 0.489804, 0.496062, 0.499568, 0.501913, 0.50172, 0.50523, 0.510124, 0.514569, 0.519906, 0.52792, 0.532602, 0.537235, 0.53624, 0.545979, 0.550187, 0.556843, 0.559497, 0.563572, 0.567946, 0.571595, 0.574597, 0.572708, 0.539393, 0.442522, 0.288509, 0.173937, 0.0522214, 0.00546089, 0.000484922, 0.000223607, 0.000105584, 0.0000172902, 0.0000129929, 0.0000103967, 0.00000864747, 0.00000717054, 0.0000062265, 0.00000555008, 0.00000357803, 0.00000362516, 0.00000438282, 0.00000422424, 0.00000402149, 0.00000385142, 0.0000036872, 0.00000372355, 0.00000353262, 0.00000346468, 0.00000341841, 0.00000303023, 0.00000285845, 0.00000284918, 0.00000158442, 1.67935e-7, 0.00000620106, 0.0000387536, 0.0000313849, 0.00000519018, 0.00000232966, 0.00000282552, 0.00000162644, 6.23867e-7, 4.10864e-7, 0.00000109819, 0.00000195123, 0.0000013061, 4.45265e-7, 3.5178e-7, 3.95582e-7, 9.00345e-7, 0.0000016101, 0.00000138795, 6.89437e-7, 2.53317e-7, 3.18852e-7, 7.49511e-7, 0.00000133982, 0.00000167249, 0.00000240731, 0.00000405962, 0.00000801347, 0.00000973833, 0.00000957187, 0.0000087575, 0.00000747327, 0.00000612066, 0.00000522092, 0.00000591808, 0.00000783124, 0.00000678816, 0.00000319556, 0.00000135017, 7.68317e-7, 6.62286e-7, 6.69086e-7, 6.11261e-7, 4.9444e-7, 3.68839e-7, 2.69949e-7, 2.16201e-7, 1.88824e-7, 1.51809e-7, 1.48345e-7, 1.57839e-7, 1.61564e-7, 9.91307e-8, 1.34069e-8],
  },
  LSST_i: {
    id: "LSST_i",
    label: "Rubin i",
    regime: "visible",
    startNm: 320,
    stepNm: 5,
    lambdaEffNm: 755.897,
    sourceLambdaEffNm: 755.899,
    provenance: {
      instrument: "Rubin Observatory / LSST",
      upstream: "https://github.com/lsst/throughputs (baseline/) — total system throughput: atmosphere x optics x filter x detector",
      reference: "Ivezic et al. (2019) ApJ 873, 111",
      note: "TOTAL throughput, so the curves peak well below 1. Not renormalized here — the level is real information about how much light each band collects.",
      fileHeader: ["LSST Throughputs files created from syseng_throughputs repo","Version 1.9","sha1 fcc05772f99427e4a45cd1b9da1628dded9a06d5","Aerosols added to atmosphere","Wavelen_cutoff_BLUE 669.90","Wavelen_cutoff_RED 837.80","Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "ed05e3432509322d8cfb60ee4baf6b8bf1c08fa5a0f011ffee22838c325a9985",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/baseline/total_i.dat",
    values: [3.75859e-10, 7.07542e-8, 8.92213e-7, 0.00000312834, 0.00000597518, 0.00000853459, 0.0000108294, 0.0000126234, 0.0000142591, 0.0000159275, 0.0000176608, 0.0000194528, 0.0000213675, 0.0000234144, 0.000025583, 0.0000277275, 0.0000298799, 0.0000318447, 0.0000336483, 0.0000353591, 0.0000368753, 0.0000382432, 0.0000395519, 0.0000406629, 0.0000416557, 0.0000425655, 0.0000434282, 0.0000441789, 0.0000448254, 0.0000454101, 0.0000460092, 0.0000465121, 0.0000468866, 0.0000473165, 0.0000476626, 0.0000479772, 0.0000481974, 0.0000482619, 0.0000485829, 0.0000488816, 0.0000490873, 0.0000491869, 0.0000492854, 0.0000495027, 0.0000497679, 0.000049902, 0.0000501523, 0.0000503869, 0.0000505412, 0.0000506517, 0.0000508073, 0.0000511934, 0.0000516584, 0.0000520699, 0.0000520071, 0.0000523718, 0.000052893, 0.0000534107, 0.0000541119, 0.0000547556, 0.0000553053, 0.000055807, 0.0000556987, 0.0000568611, 0.000057438, 0.0000578, 0.0000580462, 0.0000586493, 0.000356958, 0.000886049, 0.00402248, 0.0267892, 0.0722869, 0.146885, 0.239979, 0.403888, 0.546856, 0.602191, 0.610073, 0.60739, 0.574737, 0.575324, 0.5821, 0.604895, 0.617982, 0.620187, 0.621322, 0.622714, 0.431929, 0.455956, 0.611419, 0.620074, 0.621531, 0.621435, 0.619254, 0.618105, 0.615828, 0.605927, 0.560017, 0.449803, 0.326526, 0.192235, 0.0826425, 0.0167453, 0.00126745, 0.0000393583, 0.000025586, 0.0000628154, 0.0000626438, 0.0000623053, 0.0000619427, 0.0000612348, 0.00006065, 0.0000601798, 0.0000595871, 0.0000563521, 0.0000519803, 0.0000534669, 0.0000502879, 0.0000489663, 0.0000497267, 0.0000487161, 0.000039613, 0.000027554, 0.0000327911, 0.0000293915, 0.0000302889, 0.000029927, 0.0000305435, 0.0000308953, 0.0000321259, 0.0000292425, 0.0000283829, 0.0000273558, 0.0000256043, 0.000023641, 0.000021682, 0.0000197528, 0.0000178495, 0.0000160909, 0.0000143711, 0.0000126634, 0.0000106525, 0.00000880797, 0.00000718187, 0.00000573865, 0.00000447964, 0.00000341003, 0.00000252711, 0.00000183797, 0.0000013393, 0.00000100494, 7.39635e-7, 5.16918e-7, 3.41408e-7, 2.05491e-7, 3.59349e-8],
  },
  LSST_z: {
    id: "LSST_z",
    label: "Rubin z",
    regime: "nir",
    startNm: 320,
    stepNm: 5,
    lambdaEffNm: 867.962,
    sourceLambdaEffNm: 867.965,
    provenance: {
      instrument: "Rubin Observatory / LSST",
      upstream: "https://github.com/lsst/throughputs (baseline/) — total system throughput: atmosphere x optics x filter x detector",
      reference: "Ivezic et al. (2019) ApJ 873, 111",
      note: "TOTAL throughput, so the curves peak well below 1. Not renormalized here — the level is real information about how much light each band collects.",
      fileHeader: ["LSST Throughputs files created from syseng_throughputs repo","Version 1.9","sha1 fcc05772f99427e4a45cd1b9da1628dded9a06d5","Aerosols added to atmosphere","Wavelen_cutoff_BLUE 799.30","Wavelen_cutoff_RED 939.20","Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "66f6a80ace390130e444eabaa59bb9837bbfed6b57af299b6c2cf27a53230c52",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/baseline/total_z.dat",
    values: [3.75859e-10, 7.07542e-8, 8.92213e-7, 0.00000312834, 0.00000597518, 0.00000853459, 0.0000108294, 0.0000126234, 0.0000142591, 0.0000159275, 0.0000176608, 0.0000194528, 0.0000213675, 0.0000234144, 0.000025583, 0.0000277275, 0.0000298799, 0.0000318447, 0.0000336483, 0.0000353591, 0.0000368753, 0.0000382432, 0.0000395519, 0.0000406629, 0.0000416557, 0.0000425655, 0.0000434282, 0.0000441789, 0.0000448254, 0.0000454101, 0.0000460092, 0.0000465121, 0.0000468866, 0.0000473165, 0.0000476626, 0.0000479772, 0.0000481974, 0.0000482619, 0.0000485829, 0.0000488816, 0.0000490873, 0.0000491869, 0.0000492854, 0.0000495027, 0.0000497679, 0.000049902, 0.0000501523, 0.0000503869, 0.0000505412, 0.0000506517, 0.0000508073, 0.0000511934, 0.0000516584, 0.0000520699, 0.0000520071, 0.0000523718, 0.000052893, 0.0000534107, 0.0000541119, 0.0000547556, 0.0000553053, 0.000055807, 0.0000556987, 0.0000568611, 0.000057438, 0.0000578, 0.0000580462, 0.0000586493, 0.0000592975, 0.0000598124, 0.0000601896, 0.0000605924, 0.0000609643, 0.0000592034, 0.0000551256, 0.0000606378, 0.0000613847, 0.0000618884, 0.0000622984, 0.0000619162, 0.0000586468, 0.0000592535, 0.0000601333, 0.0000621923, 0.0000627309, 0.0000629585, 0.0000630463, 0.0000631488, 0.0000438594, 0.0000463421, 0.0000622695, 0.0000273495, 0.0000682244, 0.000062207, 0.000158659, 0.000535343, 0.00582045, 0.0455364, 0.128617, 0.225192, 0.392291, 0.538238, 0.60105, 0.621338, 0.6261, 0.624507, 0.62308, 0.620672, 0.619732, 0.617894, 0.613067, 0.607876, 0.601039, 0.595096, 0.590102, 0.557588, 0.513675, 0.52524, 0.481159, 0.420662, 0.36139, 0.241131, 0.10186, 0.0148775, 0.00135671, 0.000117857, 0.000012161, 0.00000324294, 0.00000187245, 0, 0, 0.0000116626, 0.0000283829, 0.0000273558, 0.0000256043, 0.000023641, 0.000021682, 0.0000197528, 0.0000178495, 0.0000160909, 0.0000143711, 0.0000126634, 0.0000106525, 0.00000880797, 0.00000718187, 0.00000573865, 0.00000447964, 0.00000341003, 0.00000252711, 0.00000183797, 0.0000013393, 0.00000100494, 7.39635e-7, 5.16918e-7, 3.41408e-7, 2.05491e-7, 3.59349e-8],
  },
  LSST_y: {
    id: "LSST_y",
    label: "Rubin y",
    regime: "nir",
    startNm: 320,
    stepNm: 5,
    lambdaEffNm: 975.335,
    sourceLambdaEffNm: 975.344,
    provenance: {
      instrument: "Rubin Observatory / LSST",
      upstream: "https://github.com/lsst/throughputs (baseline/) — total system throughput: atmosphere x optics x filter x detector",
      reference: "Ivezic et al. (2019) ApJ 873, 111",
      note: "TOTAL throughput, so the curves peak well below 1. Not renormalized here — the level is real information about how much light each band collects.",
      fileHeader: ["LSST Throughputs files created from syseng_throughputs repo","Version 1.9","sha1 fcc05772f99427e4a45cd1b9da1628dded9a06d5","Aerosols added to atmosphere","Wavelen_cutoff_BLUE 907.50","Wavelen_cutoff_RED 1100.00","Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "f10cc09307ef535c323d9af473b4c4c8dc5905cbf50f91eea1a07cbb38008a20",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/baseline/total_y.dat",
    values: [3.75859e-10, 7.07542e-8, 8.92213e-7, 0.00000312834, 0.00000597518, 0.00000853459, 0.0000108294, 0.0000126234, 0.0000142591, 0.0000159275, 0.0000176608, 0.0000194528, 0.0000213675, 0.0000234144, 0.000025583, 0.0000277275, 0.0000298799, 0.0000318447, 0.0000336483, 0.0000353591, 0.0000368753, 0.0000382432, 0.0000395519, 0.0000406629, 0.0000416557, 0.0000425655, 0.0000434282, 0.0000441789, 0.0000448254, 0.0000454101, 0.0000460092, 0.0000465121, 0.0000468866, 0.0000473165, 0.0000476626, 0.0000479772, 0.0000481974, 0.0000482619, 0.0000485829, 0.0000488816, 0.0000490873, 0.0000491869, 0.0000492854, 0.0000495027, 0.0000497679, 0.000049902, 0.0000501523, 0.0000503869, 0.0000505412, 0.0000506517, 0.0000508073, 0.0000511934, 0.0000516584, 0.0000520699, 0.0000520071, 0.0000523718, 0.000052893, 0.0000534107, 0.0000541119, 0.0000547556, 0.0000553053, 0.000055807, 0.0000556987, 0.0000568611, 0.000057438, 0.0000578, 0.0000580462, 0.0000586493, 0.0000592975, 0.0000598124, 0.0000601896, 0.0000605924, 0.0000609643, 0.0000592034, 0.0000551256, 0.0000606378, 0.0000613847, 0.0000618884, 0.0000622984, 0.0000619162, 0.0000586468, 0.0000592535, 0.0000601333, 0.0000621923, 0.0000627309, 0.0000629585, 0.0000630463, 0.0000631488, 0.0000438594, 0.0000463421, 0.0000622695, 0.000063329, 0.0000633734, 0.000063356, 0.0000630229, 0.000063139, 0.0000631602, 0.0000632819, 0.0000631708, 0.0000601207, 0.0000603225, 0.0000604788, 0.0000612236, 0.0000628024, 0.0000632455, 0.0000632017, 0.000063066, 0.0000628154, 0.0000626438, 0.0000623053, 0.0000619427, 0.0000612348, 0.000361771, 0.000581838, 0.000597798, 0.000620841, 0.000724374, 0.00151715, 0.00653942, 0.034438, 0.0961453, 0.180711, 0.242334, 0.232398, 0.309819, 0.283915, 0.294808, 0.292539, 0.300283, 0.30515, 0.317997, 0.289772, 0.281131, 0.270754, 0.25312, 0.233681, 0.214586, 0.1958, 0.176958, 0.15946, 0.142468, 0.125542, 0.10567, 0.0873627, 0.0711868, 0.0568293, 0.0443331, 0.0337539, 0.0249961, 0.0181917, 0.0132619, 0.00993647, 0.00731609, 0.00510615, 0.00336606, 0.00202176, 0.000351895],
  },
  Gaia_G: {
    id: "Gaia_G",
    label: "Gaia G",
    regime: "visible",
    startNm: 320,
    stepNm: 5,
    lambdaEffNm: 639.022,
    sourceLambdaEffNm: 639.022,
    provenance: {
      instrument: "Gaia DR3",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs GAIA/GAIA3.{G,Gbp,Grp}",
      reference: "Riello et al. (2021) A&A 649, A3",
      note: "PHOTON-counting total responses.",
      fileHeader: [],
    },
    sourceSha256: "13cc7b350ecd47d7b37c0bd85cf351989bdbfd508e2ae0d6b668bfeeaf8708db",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=GAIA/GAIA3.G",
    values: [3.03712e-7, 0.000354006, 0.0113946, 0.0479322, 0.0864402, 0.113095, 0.125397, 0.126658, 0.121397, 0.114397, 0.109597, 0.108827, 0.117306, 0.14768, 0.205267, 0.27617, 0.340077, 0.392107, 0.433137, 0.466195, 0.492751, 0.514358, 0.532316, 0.547589, 0.560094, 0.571783, 0.581808, 0.590798, 0.598838, 0.606111, 0.612657, 0.619021, 0.624798, 0.629487, 0.63447, 0.63929, 0.643286, 0.647492, 0.651448, 0.655057, 0.658941, 0.662419, 0.665556, 0.669374, 0.672429, 0.674956, 0.677766, 0.680914, 0.683226, 0.685952, 0.688028, 0.69018, 0.693036, 0.695172, 0.697701, 0.69976, 0.701697, 0.703731, 0.70604, 0.7082, 0.709865, 0.711045, 0.712641, 0.71411, 0.715169, 0.716109, 0.716888, 0.71729, 0.717774, 0.717949, 0.717769, 0.717328, 0.716282, 0.714666, 0.713429, 0.711338, 0.709147, 0.706041, 0.702336, 0.698722, 0.693976, 0.689178, 0.683305, 0.677382, 0.670556, 0.662524, 0.654673, 0.645867, 0.636555, 0.626985, 0.615876, 0.604762, 0.592855, 0.58026, 0.567536, 0.554159, 0.539715, 0.525141, 0.510118, 0.495599, 0.479369, 0.463362, 0.447244, 0.431661, 0.414509, 0.39817, 0.380604, 0.363997, 0.347136, 0.33063, 0.313414, 0.297982, 0.280955, 0.264807, 0.249414, 0.23371, 0.218409, 0.203663, 0.189403, 0.175593, 0.162087, 0.149065, 0.136958, 0.125213, 0.113885, 0.103226, 0.0932408, 0.0838625, 0.0749712, 0.0666018, 0.0588491, 0.0518288, 0.045216, 0.0393004, 0.033871, 0.0289013, 0.0245312, 0.0205708, 0.017122, 0.0140686, 0.0114248, 0.00919485, 0.00727444, 0.00569729, 0.00437889, 0.00330329, 0.00130732],
  },
  Gaia_BP: {
    id: "Gaia_BP",
    label: "Gaia BP",
    regime: "visible",
    startNm: 325,
    stepNm: 5,
    lambdaEffNm: 518.258,
    sourceLambdaEffNm: 518.258,
    provenance: {
      instrument: "Gaia DR3",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs GAIA/GAIA3.{G,Gbp,Grp}",
      reference: "Riello et al. (2021) A&A 649, A3",
      note: "PHOTON-counting total responses.",
      fileHeader: [],
    },
    sourceSha256: "54030b988a787444d0f10791aefc9d6b80d03af4eb2d1390fa6725fb771e961f",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=GAIA/GAIA3.Gbp",
    values: [0.000198435, 0.0150245, 0.0967495, 0.20698, 0.241649, 0.189585, 0.198799, 0.232403, 0.22378, 0.204089, 0.178746, 0.16413, 0.186364, 0.255143, 0.347203, 0.430727, 0.491771, 0.533126, 0.560266, 0.578112, 0.590077, 0.598932, 0.607331, 0.615298, 0.622852, 0.626836, 0.627737, 0.62704, 0.627476, 0.629192, 0.632414, 0.634937, 0.635371, 0.635115, 0.633772, 0.631893, 0.630875, 0.630218, 0.629908, 0.629651, 0.627491, 0.62376, 0.621311, 0.620077, 0.62037, 0.622425, 0.622801, 0.61914, 0.614252, 0.608431, 0.60581, 0.613876, 0.630391, 0.642035, 0.640797, 0.627955, 0.614341, 0.613831, 0.625988, 0.648938, 0.665934, 0.666471, 0.650674, 0.620399, 0.578663, 0.527872, 0.460028, 0.337703, 0.161579, 0.0395879, 0.00476186, 0.000799422, 0.000492587, 0.000284924, 0.00011875, 0.0000233926, 0.00000692448, 0.0000041352, 0.00000303058, 0.00000116706, 4.35711e-7, 1.72335e-7, 8.15161e-8, 4.04973e-8, 6.06713e-8, 1.85348e-8],
  },
  Gaia_RP: {
    id: "Gaia_RP",
    label: "Gaia RP",
    regime: "visible",
    startNm: 610,
    stepNm: 5,
    lambdaEffNm: 782.508,
    sourceLambdaEffNm: 782.508,
    provenance: {
      instrument: "Gaia DR3",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs GAIA/GAIA3.{G,Gbp,Grp}",
      reference: "Riello et al. (2021) A&A 649, A3",
      note: "PHOTON-counting total responses.",
      fileHeader: [],
    },
    sourceSha256: "e5f457226c33494f2722e35ddceb93061e1f8b3ea5174a985b9d618f51eee83d",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=GAIA/GAIA3.Grp",
    values: [0.0000860807, 0.000888447, 0.0110338, 0.101286, 0.393716, 0.67204, 0.721599, 0.681108, 0.692513, 0.699507, 0.706734, 0.716887, 0.726007, 0.731155, 0.731505, 0.729698, 0.731576, 0.734406, 0.737149, 0.737381, 0.735091, 0.732227, 0.731461, 0.73475, 0.739904, 0.743415, 0.743026, 0.73992, 0.73887, 0.739582, 0.739631, 0.737343, 0.730433, 0.723118, 0.715451, 0.708661, 0.704796, 0.703463, 0.703793, 0.703683, 0.701266, 0.697987, 0.691013, 0.683445, 0.674897, 0.666434, 0.654957, 0.643594, 0.628989, 0.614579, 0.598422, 0.582338, 0.564974, 0.550603, 0.533055, 0.516682, 0.500535, 0.482218, 0.46302, 0.443579, 0.423547, 0.403107, 0.382646, 0.361939, 0.341153, 0.320275, 0.299026, 0.277423, 0.256846, 0.236504, 0.216424, 0.197504, 0.17974, 0.162244, 0.146463, 0.130653, 0.114952, 0.0980958, 0.0816955, 0.0661889, 0.0521899, 0.0401289, 0.030399, 0.0227121, 0.0168058, 0.0121711, 0.00873288, 0.00612515, 0.00422221, 0.00286904, 0.00189609, 0.00123531, 0.000789671, 0.000490706, 0.000169838],
  },
  U: {
    id: "U",
    label: "Johnson U",
    regime: "uv",
    startNm: 294,
    stepNm: 2,
    lambdaEffNm: 361.825,
    sourceLambdaEffNm: 361.825,
    provenance: {
      instrument: "Johnson-Cousins (generic)",
      upstream: "https://github.com/lsst/throughputs (johnson/) — johnson_{U,B,V}.dat and cousins_{R,I}.dat",
      reference: "Mann & von Braun (2015) PASP 127, 102; Bessell (1990) PASP 102, 1181",
      note: "FILTER transmission normalized to a peak of 1, NOT a system throughput — no telescope, detector or atmosphere. The generic system a synthetic UBVRI colour is defined on, which is what it is used for here.",
      fileHeader: ["Date Updated: 12/18/2015","Source: Mann and Von Braun (2015), PASP, 127, 102 (http://www.jstor.org/stable/10.1086/680012)","Wavelength(nm) Transmission(0-1)"],
    },
    sourceSha256: "8a10535d5620f1419a97f28a0d48818f72d9212905ca3502038b8eea4063544d",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/johnson/johnson_U.dat",
    values: [0.00111842, 0.0126316, 0.026943, 0.0425004, 0.0594302, 0.0776959, 0.0965091, 0.116374, 0.137605, 0.1602, 0.183579, 0.207058, 0.232095, 0.257989, 0.284784, 0.311684, 0.339175, 0.367295, 0.396246, 0.425685, 0.455994, 0.486404, 0.517436, 0.549724, 0.581699, 0.614275, 0.647023, 0.679772, 0.711895, 0.743413, 0.77394, 0.803012, 0.830825, 0.85776, 0.884004, 0.908883, 0.932398, 0.954549, 0.974645, 0.990326, 0.998456, 0.996885, 0.983494, 0.95584, 0.914044, 0.857313, 0.787437, 0.707897, 0.62407, 0.539656, 0.457608, 0.380081, 0.308846, 0.246014, 0.191006, 0.144827, 0.106962, 0.0767822, 0.0528421, 0.0350676, 0.021883, 0.0121798, 0.00609942],
  },
  B: {
    id: "B",
    label: "Johnson B",
    regime: "visible",
    startNm: 357.5,
    stepNm: 2.5,
    lambdaEffNm: 440.998,
    sourceLambdaEffNm: 440.998,
    provenance: {
      instrument: "Johnson-Cousins (generic)",
      upstream: "https://github.com/lsst/throughputs (johnson/) — johnson_{U,B,V}.dat and cousins_{R,I}.dat",
      reference: "Mann & von Braun (2015) PASP 127, 102; Bessell (1990) PASP 102, 1181",
      note: "FILTER transmission normalized to a peak of 1, NOT a system throughput — no telescope, detector or atmosphere. The generic system a synthetic UBVRI colour is defined on, which is what it is used for here.",
      fileHeader: ["Date Updated: 12/18/2015","Source: Mann and Von Braun (2015), PASP, 127, 102 (http://www.jstor.org/stable/10.1086/680012)","Wavelength(nm) Transmission(0-1)"],
    },
    sourceSha256: "39e3120fcea3c5817531ec1a0928c7722ee29fce6c001e3fa53460ed5e794377",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/johnson/johnson_B.dat",
    values: [0.00180511, 0.006634, 0.0118214, 0.019149, 0.0314256, 0.0486156, 0.0699154, 0.103154, 0.162127, 0.244163, 0.334286, 0.425437, 0.51401, 0.601086, 0.686255, 0.757954, 0.805862, 0.836838, 0.86564, 0.891338, 0.912739, 0.93233, 0.950138, 0.963915, 0.974404, 0.982738, 0.989821, 0.994665, 0.997916, 0.999602, 0.998799, 0.994023, 0.98557, 0.975285, 0.962093, 0.944156, 0.922798, 0.900387, 0.878359, 0.856921, 0.835468, 0.813377, 0.789688, 0.765066, 0.739459, 0.712943, 0.684964, 0.654691, 0.623324, 0.591623, 0.561215, 0.53096, 0.500777, 0.470531, 0.440464, 0.410859, 0.380072, 0.349674, 0.319417, 0.288446, 0.258271, 0.23129, 0.208705, 0.187245, 0.165819, 0.144361, 0.122933, 0.101499, 0.0813371, 0.0636452, 0.0476267, 0.0325953, 0.0206484, 0.0129416, 0.00757813],
  },
  V: {
    id: "V",
    label: "Johnson V",
    regime: "visible",
    startNm: 470,
    stepNm: 5,
    lambdaEffNm: 552.384,
    sourceLambdaEffNm: 552.384,
    provenance: {
      instrument: "Johnson-Cousins (generic)",
      upstream: "https://github.com/lsst/throughputs (johnson/) — johnson_{U,B,V}.dat and cousins_{R,I}.dat",
      reference: "Mann & von Braun (2015) PASP 127, 102; Bessell (1990) PASP 102, 1181",
      note: "FILTER transmission normalized to a peak of 1, NOT a system throughput — no telescope, detector or atmosphere. The generic system a synthetic UBVRI colour is defined on, which is what it is used for here.",
      fileHeader: ["Date Updated: 12/18/2015","Source: Mann and Von Braun (2015), PASP, 127, 102 (http://www.jstor.org/stable/10.1086/680012)","Wavelength(nm) Transmission(0-1)"],
    },
    sourceSha256: "4efc80c0882a404dc61b7fdfb5043ace83405c94a7656d177a92f966171bf239",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/johnson/johnson_V.dat",
    values: [0.000193301, 0.0138338, 0.0436991, 0.0934814, 0.172346, 0.285139, 0.426084, 0.577846, 0.724677, 0.848751, 0.934786, 0.983523, 0.99683, 0.981628, 0.951931, 0.910916, 0.862934, 0.809402, 0.751395, 0.692432, 0.636219, 0.584466, 0.535059, 0.486416, 0.437373, 0.390029, 0.345083, 0.303512, 0.265051, 0.229578, 0.198053, 0.169809, 0.144267, 0.122094, 0.102217, 0.0845644, 0.0686015, 0.0547587, 0.0422333, 0.0319771, 0.0241294, 0.0180949, 0.0135805, 0.0105745, 0.00823178, 0.00681436, 0.00601477, 0.00534166, 0.00421103, 0.00377297, 0.00302382, 0.00298187, 0.00224498, 0.002, 0.00165006, 0.001, 0.001, 0.000834568, 0.0000515432],
  },
  R: {
    id: "R",
    label: "Cousins R",
    regime: "visible",
    startNm: 540,
    stepNm: 5,
    lambdaEffNm: 646.944,
    sourceLambdaEffNm: 646.944,
    provenance: {
      instrument: "Johnson-Cousins (generic)",
      upstream: "https://github.com/lsst/throughputs (johnson/) — johnson_{U,B,V}.dat and cousins_{R,I}.dat",
      reference: "Mann & von Braun (2015) PASP 127, 102; Bessell (1990) PASP 102, 1181",
      note: "FILTER transmission normalized to a peak of 1, NOT a system throughput — no telescope, detector or atmosphere. The generic system a synthetic UBVRI colour is defined on, which is what it is used for here.",
      fileHeader: ["https://svo2.cab.inta-csic.es/theory/fps/index.php?id=Generic/Cousins.R&&mode=search&search_text=COUSINS#filter","Wavelength(nm) Transmission(0-1)"],
    },
    sourceSha256: "24aff75a8ce95cdaa38e1d7e4b7c8d348ffbb174265441e76fbbbd00ff4ae5ad",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/johnson/cousins_R.dat",
    values: [0.00025, 0.00275, 0.0115, 0.0325, 0.07875, 0.19375, 0.41875, 0.73875, 0.88375, 0.955, 0.987375, 0.998, 0.9995, 0.9965, 0.989125, 0.97575, 0.96025, 0.94575, 0.92975, 0.912125, 0.89525, 0.879375, 0.860625, 0.844375, 0.825125, 0.806125, 0.787375, 0.765, 0.742125, 0.72025, 0.6995, 0.67575, 0.65025, 0.62575, 0.59925, 0.56725, 0.5285, 0.475625, 0.39375, 0.30125, 0.218125, 0.158125, 0.121875, 0.100625, 0.085625, 0.074375, 0.060625, 0.05, 0.039875, 0.02925, 0.019875, 0.01, 0.00125],
  },
  I: {
    id: "I",
    label: "Cousins I",
    regime: "nir",
    startNm: 700,
    stepNm: 2.5,
    lambdaEffNm: 788.559,
    sourceLambdaEffNm: 788.559,
    provenance: {
      instrument: "Johnson-Cousins (generic)",
      upstream: "https://github.com/lsst/throughputs (johnson/) — johnson_{U,B,V}.dat and cousins_{R,I}.dat",
      reference: "Mann & von Braun (2015) PASP 127, 102; Bessell (1990) PASP 102, 1181",
      note: "FILTER transmission normalized to a peak of 1, NOT a system throughput — no telescope, detector or atmosphere. The generic system a synthetic UBVRI colour is defined on, which is what it is used for here.",
      fileHeader: ["https://svo2.cab.inta-csic.es/theory/fps/index.php?id=Generic/Cousins.I&&mode=search&search_text=COUSINS#filter","Wavelength(nm) Transmission(0-1)"],
    },
    sourceSha256: "1091d97e4fe57e7c3a100c1861cde3495239e0213b64fa0802e27fecf8409e01",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/johnson/cousins_I.dat",
    values: [0.0003125, 0.0025, 0.005625, 0.0125, 0.0209375, 0.035, 0.05125, 0.075, 0.10125, 0.135, 0.175625, 0.25, 0.343125, 0.515, 0.684375, 0.76, 0.8175, 0.86, 0.898125, 0.925, 0.94875, 0.965, 0.97875, 0.985, 0.989625, 0.992, 0.992875, 0.987, 0.979, 0.965, 0.949562, 0.9315, 0.912625, 0.8915, 0.870187, 0.85, 0.83, 0.81, 0.79, 0.77, 0.75, 0.73, 0.710187, 0.6915, 0.673875, 0.6615, 0.650188, 0.64, 0.63, 0.62, 0.609375, 0.595, 0.58, 0.565, 0.549375, 0.53, 0.51, 0.49, 0.468437, 0.4375, 0.404375, 0.3675, 0.329688, 0.29, 0.250625, 0.215, 0.181875, 0.16, 0.140625, 0.125, 0.11, 0.095, 0.080625, 0.07, 0.0596875, 0.0475, 0.035625, 0.0275, 0.0203125, 0.015, 0.0103125, 0.0075, 0.005, 0.0025, 0.0003125],
  },
  J: {
    id: "J",
    label: "2MASS J",
    regime: "nir",
    startNm: 1060,
    stepNm: 5,
    lambdaEffNm: 1241.04,
    sourceLambdaEffNm: 1241.05,
    provenance: {
      instrument: "2MASS",
      upstream: "https://github.com/lsst/throughputs (2MASS/) — 2MASS_{J,H,Ks}.dat, themselves from the SVO service (https://svo2.cab.inta-csic.es/theory/fps/)",
      reference: "Cohen, Wheaton & Megeath (2003) AJ 126, 1090",
      note: "Relative spectral response normalized to a peak of 1. The third band is Ks (2.16 um), not the older K (2.19 um) — the name in this package is K and the curve is Ks, which is the standard modern choice.",
      fileHeader: ["Date Updated: 12/18/2015","Source: http://svo2.cab.inta-csic.es/svo/theory/fps3/index.php?mode=browse&gname=2MASS","Wavelength(nm) Transmission(0-1)"],
    },
    sourceSha256: "d5b0282111eee65ec152916c4eb171e0da233733b97d61678998b9d31e4198b3",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/2MASS/2MASS_J.dat",
    values: [0.00000234375, 0.000338281, 0.00147813, 0.00313333, 0.00897188, 0.0236449, 0.0427687, 0.0549447, 0.0681831, 0.252035, 0.364854, 0.328022, 0.254808, 0.272883, 0.363428, 0.353223, 0.323997, 0.392472, 0.286886, 0.282815, 0.286154, 0.592869, 0.674883, 0.753612, 0.809947, 0.806705, 0.835457, 0.761291, 0.706646, 0.701414, 0.703926, 0.702601, 0.723914, 0.71564, 0.804227, 0.904195, 0.950078, 0.963403, 0.9411, 0.893723, 0.811308, 0.747625, 0.683887, 0.653487, 0.640171, 0.641999, 0.646668, 0.669052, 0.724549, 0.781635, 0.772583, 0.853597, 0.858028, 0.931129, 0.902861, 0.516815, 0.794632, 0.586149, 0.196099, 0.0107992, 0.0276958, 0.00356406, 0.0083625, 0.0185598, 0.00025, 0.0000424219, 0.00167609, 0.00973672, 0.0431703, 0.0244187, 0.00287493, 0.00724891, 0.00260812, 0.000398867, 0.000325, 0.00035625, 0.000386182, 0.00025, 0.00003125],
  },
  H: {
    id: "H",
    label: "2MASS H",
    regime: "nir",
    startNm: 1420,
    stepNm: 5,
    lambdaEffNm: 1651.34,
    sourceLambdaEffNm: 1651.37,
    provenance: {
      instrument: "2MASS",
      upstream: "https://github.com/lsst/throughputs (2MASS/) — 2MASS_{J,H,Ks}.dat, themselves from the SVO service (https://svo2.cab.inta-csic.es/theory/fps/)",
      reference: "Cohen, Wheaton & Megeath (2003) AJ 126, 1090",
      note: "Relative spectral response normalized to a peak of 1. The third band is Ks (2.16 um), not the older K (2.19 um) — the name in this package is K and the curve is Ks, which is the standard modern choice.",
      fileHeader: ["Date Updated: 12/18/2015","Source: http://svo2.cab.inta-csic.es/svo/theory/fps3/index.php?mode=browse&gname=2MASS","Wavelength(nm) Transmission(0-1)"],
    },
    sourceSha256: "bf27acd6e21318e1a871dbe05933288632ec10427a9b355cbd1807c8777f8e16",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/2MASS/2MASS_H.dat",
    values: [0.0000459872, 0.000159091, 0.000272727, 0.000386364, 0.000551136, 0.00102273, 0.00154545, 0.00206818, 0.00259622, 0.00379375, 0.00545, 0.00710625, 0.0133026, 0.0273867, 0.0620714, 0.10793, 0.159836, 0.225363, 0.330564, 0.436678, 0.533662, 0.629123, 0.710179, 0.770209, 0.826624, 0.872257, 0.905221, 0.923278, 0.927967, 0.92408, 0.888985, 0.863217, 0.8696, 0.89048, 0.910159, 0.92313, 0.915369, 0.912618, 0.920982, 0.924106, 0.921202, 0.922967, 0.923907, 0.927618, 0.937714, 0.94545, 0.956176, 0.973748, 0.992918, 0.99685, 0.998621, 0.986492, 0.969608, 0.954545, 0.944806, 0.935394, 0.9273, 0.940671, 0.961386, 0.980006, 0.986058, 0.989992, 0.990875, 0.989667, 0.987099, 0.980373, 0.967469, 0.92444, 0.88065, 0.824986, 0.746736, 0.652198, 0.46825, 0.317031, 0.399815, 0.227627, 0.135729, 0.0972237, 0.0603369, 0.0116423, 0.0159642, 0.00628, 0.000330313, 0.000039881, 0.0000333333, 0.0000666667, 0.0000928571, 0.0000761905, 0.000052381, 0.0000285714, 0.00000580357],
  },
  K: {
    id: "K",
    label: "2MASS Ks",
    regime: "nir",
    startNm: 1925,
    stepNm: 5,
    lambdaEffNm: 2165.61,
    sourceLambdaEffNm: 2165.63,
    provenance: {
      instrument: "2MASS",
      upstream: "https://github.com/lsst/throughputs (2MASS/) — 2MASS_{J,H,Ks}.dat, themselves from the SVO service (https://svo2.cab.inta-csic.es/theory/fps/)",
      reference: "Cohen, Wheaton & Megeath (2003) AJ 126, 1090",
      note: "Relative spectral response normalized to a peak of 1. The third band is Ks (2.16 um), not the older K (2.19 um) — the name in this package is K and the curve is Ks, which is the standard modern choice.",
      fileHeader: ["Date Updated: 12/18/2015","Source: http://svo2.cab.inta-csic.es/svo/theory/fps3/index.php?mode=browse&gname=2MASS","Wavelength(nm) Transmission(0-1)"],
    },
    sourceSha256: "84670f74b8e46834b4336c787b04ec7fb9b7649bb8906cc6029cc9ad2f56e543",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/2MASS/2MASS_Ks.dat",
    values: [6.69643e-7, 0.0000857143, 0.000266875, 0.00115042, 0.00376667, 0.00684861, 0.0104752, 0.0166188, 0.0293429, 0.0493491, 0.0823134, 0.139443, 0.2005, 0.214568, 0.217512, 0.246054, 0.27639, 0.329396, 0.379408, 0.377767, 0.526, 0.652403, 0.732503, 0.758025, 0.743115, 0.708494, 0.670587, 0.636336, 0.661609, 0.70675, 0.705786, 0.759557, 0.800843, 0.817729, 0.82092, 0.829749, 0.856702, 0.871586, 0.871132, 0.863257, 0.895145, 0.905414, 0.913843, 0.921144, 0.926088, 0.92675, 0.925554, 0.917486, 0.908271, 0.905116, 0.917043, 0.887244, 0.853725, 0.885758, 0.928589, 0.955309, 0.970991, 0.983362, 0.98661, 0.981909, 0.97475, 0.967684, 0.974765, 0.982091, 0.982909, 0.977806, 0.965646, 0.980736, 0.976356, 0.974675, 0.941692, 0.917944, 0.912477, 0.861303, 0.720945, 0.550928, 0.459892, 0.366316, 0.255266, 0.169837, 0.130179, 0.0838578, 0.0620362, 0.0419373, 0.0321981, 0.018262, 0.0101333, 0.0068099, 0.00143633, 0.00268214, 0.00209444, 0.00115556, 0.000408819, 0.00024, 0.000106667, 0.00000583333],
  },
  SDSS_u: {
    id: "SDSS_u",
    label: "SDSS u",
    regime: "uv",
    startNm: 300,
    stepNm: 5,
    lambdaEffNm: 360.012,
    sourceLambdaEffNm: 360.012,
    provenance: {
      instrument: "SDSS 2.5 m",
      upstream: "https://github.com/lsst/throughputs (sdss/) — doi_{u,g,r,i,z}.dat",
      reference: "Doi et al. (2010) AJ 139, 1628",
      note: "As-measured total responses at 1.3 airmasses. The doi_* curves are used rather than the sdss_* Gunn curves beside them because they are the refereed, citable measurement — the Gunn files' own header points only at a retired sdss.org DR3 page.",
      fileHeader: ["Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "1a29404ddb194d3f93b12a3e9e9d59d000e5ac3b8146f79499eea7b6b7b232f9",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/sdss/doi_u.dat",
    values: [0.000036177, 0.000409803, 0.00224032, 0.00797906, 0.0182779, 0.0299678, 0.0409352, 0.0513937, 0.0603678, 0.0677265, 0.0762609, 0.0827146, 0.0878132, 0.0929926, 0.0962772, 0.0923745, 0.079066, 0.0536179, 0.0263503, 0.00963111, 0.00223616, 0.000489094, 0.000213298, 0.000115552, 0.0000721748, 0.0000721025, 0.0000719818, 0.0000717804, 0.000071542, 0.0000712543, 0.0000709356, 0.0000705343, 0.0000700797, 0.000069522, 0.0000689078, 0.0000681826, 0.0000674345, 0.0000666697, 0.0000658767, 0.0000649793, 0.0000640483, 0.0000630523, 0.0000620352, 0.000061014, 0.0000599856, 0.00005897, 0.0000579498, 0.0000569225, 0.0000558762, 0.0000547578, 0.0000536258, 0.0000524879, 0.000051349, 0.0000502072, 0.0000490623, 0.0000479147, 0.0000467823, 0.0000457591, 0.000044745, 0.0000437173, 0.0000426933, 0.0000417416, 0.0000407777, 0.0000397407, 0.0000386726, 0.000037536, 0.0000363813, 0.0000352008, 0.0000340112, 0.0000328145, 0.0000316059, 0.0000303572, 0.0000290992, 0.0000278357, 0.0000265699, 0.0000253016, 0.0000240228, 0.0000219267, 0.000020228, 0.0000197631, 0.0000189416, 0.0000176634, 0.0000163743, 0.0000146994, 0.0000128612, 0.0000119112, 0.0000107923, 0.00000986191, 0.00000858917, 0.00000727742, 0.00000596386, 0.00000464249, 0.00000281193, 0.0000805943, 0.000377922, 0.000610451, 0.000385844, 0.000133125, 0.0000258682, 0.00000206359],
  },
  SDSS_g: {
    id: "SDSS_g",
    label: "SDSS g",
    regime: "visible",
    startNm: 362.5,
    stepNm: 2.5,
    lambdaEffNm: 471.762,
    sourceLambdaEffNm: 471.762,
    provenance: {
      instrument: "SDSS 2.5 m",
      upstream: "https://github.com/lsst/throughputs (sdss/) — doi_{u,g,r,i,z}.dat",
      reference: "Doi et al. (2010) AJ 139, 1628",
      note: "As-measured total responses at 1.3 airmasses. The doi_* curves are used rather than the sdss_* Gunn curves beside them because they are the refereed, citable measurement — the Gunn files' own header points only at a retired sdss.org DR3 page.",
      fileHeader: ["Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "7d9ff4c8496af8d9863f714fb302d08bc3527d56a0ee81aa9f91edb8bcc4e15f",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/sdss/doi_g.dat",
    values: [0.000311073, 0.00121027, 0.00201641, 0.00207424, 0.00190859, 0.00206214, 0.00279356, 0.00441953, 0.00902344, 0.0181275, 0.0302233, 0.0478494, 0.0679492, 0.0899724, 0.113919, 0.141955, 0.168881, 0.187835, 0.204414, 0.221187, 0.236881, 0.248996, 0.25934, 0.267191, 0.274183, 0.2812, 0.288285, 0.295428, 0.302214, 0.308056, 0.313614, 0.319179, 0.324744, 0.330367, 0.335725, 0.340076, 0.343956, 0.347865, 0.351765, 0.355621, 0.359176, 0.362355, 0.365435, 0.368453, 0.371202, 0.373959, 0.376674, 0.378945, 0.381161, 0.383419, 0.385683, 0.387888, 0.38981, 0.39166, 0.393568, 0.395389, 0.39709, 0.398777, 0.400393, 0.401613, 0.401607, 0.400478, 0.39832, 0.395387, 0.389474, 0.375151, 0.345749, 0.290789, 0.219549, 0.145762, 0.0884102, 0.051809, 0.0316242, 0.0196814, 0.0128719, 0.00840644, 0.00553088, 0.00378595, 0.00235439, 0.00111939, 0.0000948977],
  },
  SDSS_r: {
    id: "SDSS_r",
    label: "SDSS r",
    regime: "visible",
    startNm: 538,
    stepNm: 2,
    lambdaEffNm: 618.68,
    sourceLambdaEffNm: 618.68,
    provenance: {
      instrument: "SDSS 2.5 m",
      upstream: "https://github.com/lsst/throughputs (sdss/) — doi_{u,g,r,i,z}.dat",
      reference: "Doi et al. (2010) AJ 139, 1628",
      note: "As-measured total responses at 1.3 airmasses. The doi_* curves are used rather than the sdss_* Gunn curves beside them because they are the refereed, citable measurement — the Gunn files' own header points only at a retired sdss.org DR3 page.",
      fileHeader: ["Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "f3b7772fef06e71cf1b3b246445389c087c88cb1ec17071c9c61ae315e80fcbc",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/sdss/doi_r.dat",
    values: [0.000256801, 0.00171338, 0.00453214, 0.00970178, 0.0204535, 0.0395772, 0.0658477, 0.101431, 0.141213, 0.181894, 0.220542, 0.256279, 0.289829, 0.320605, 0.348263, 0.372509, 0.390468, 0.402829, 0.412471, 0.420802, 0.428063, 0.434293, 0.439508, 0.444587, 0.449094, 0.452307, 0.455321, 0.458343, 0.461366, 0.464331, 0.467051, 0.469278, 0.471749, 0.474243, 0.476687, 0.478647, 0.47934, 0.479581, 0.479716, 0.479971, 0.481159, 0.484102, 0.487059, 0.489997, 0.492862, 0.495251, 0.496748, 0.497984, 0.499178, 0.500346, 0.501087, 0.500988, 0.500791, 0.500552, 0.500306, 0.500305, 0.500803, 0.501039, 0.500912, 0.500129, 0.499046, 0.496315, 0.489809, 0.477631, 0.459032, 0.430339, 0.389287, 0.338928, 0.279487, 0.217325, 0.160593, 0.113703, 0.078643, 0.0513619, 0.0335803, 0.0238232, 0.0175338, 0.0119368, 0.0088658, 0.00693627, 0.00505079, 0.00335839, 0.00177879, 0.000325634],
  },
  SDSS_i: {
    id: "SDSS_i",
    label: "SDSS i",
    regime: "visible",
    startNm: 660,
    stepNm: 2,
    lambdaEffNm: 750.621,
    sourceLambdaEffNm: 750.62,
    provenance: {
      instrument: "SDSS 2.5 m",
      upstream: "https://github.com/lsst/throughputs (sdss/) — doi_{u,g,r,i,z}.dat",
      reference: "Doi et al. (2010) AJ 139, 1628",
      note: "As-measured total responses at 1.3 airmasses. The doi_* curves are used rather than the sdss_* Gunn curves beside them because they are the refereed, citable measurement — the Gunn files' own header points only at a retired sdss.org DR3 page.",
      fileHeader: ["Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "5d548277da8e10cf4f9856e5f0f815991c23ae2e575c9e865d95af630cfe73be",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/sdss/doi_i.dat",
    values: [0.000161195, 0.00071409, 0.00111759, 0.0016137, 0.00252535, 0.00440651, 0.00758192, 0.0126072, 0.0213889, 0.034384, 0.052692, 0.077503, 0.105538, 0.136741, 0.168656, 0.207777, 0.250794, 0.289701, 0.325611, 0.357869, 0.381104, 0.399577, 0.41423, 0.424637, 0.432525, 0.43837, 0.44359, 0.444189, 0.429626, 0.414769, 0.419037, 0.425264, 0.424383, 0.422057, 0.419731, 0.418341, 0.422715, 0.426838, 0.424789, 0.421958, 0.419506, 0.416916, 0.414292, 0.411656, 0.40895, 0.406233, 0.403363, 0.399556, 0.394605, 0.366887, 0.255332, 0.253883, 0.254547, 0.3117, 0.363515, 0.367316, 0.363221, 0.359072, 0.354941, 0.350788, 0.346663, 0.342796, 0.340234, 0.338048, 0.335877, 0.333778, 0.331582, 0.329435, 0.32734, 0.325513, 0.323865, 0.321941, 0.319796, 0.317341, 0.314086, 0.308514, 0.294721, 0.272551, 0.246565, 0.211755, 0.166723, 0.121725, 0.0804362, 0.0526977, 0.0330621, 0.0199521, 0.013397, 0.00898772, 0.00567238, 0.0014323],
  },
  SDSS_z: {
    id: "SDSS_z",
    label: "SDSS z",
    regime: "nir",
    startNm: 770,
    stepNm: 5,
    lambdaEffNm: 891.822,
    sourceLambdaEffNm: 891.823,
    provenance: {
      instrument: "SDSS 2.5 m",
      upstream: "https://github.com/lsst/throughputs (sdss/) — doi_{u,g,r,i,z}.dat",
      reference: "Doi et al. (2010) AJ 139, 1628",
      note: "As-measured total responses at 1.3 airmasses. The doi_* curves are used rather than the sdss_* Gunn curves beside them because they are the refereed, citable measurement — the Gunn files' own header points only at a retired sdss.org DR3 page.",
      fileHeader: ["Wavelength(nm)  Throughput(0-1)"],
    },
    sourceSha256: "e83e2f7d673a68b9abf1a651037796cb92463a451e77dcb50dbf1ce89d55289a",
    readFrom: "https://raw.githubusercontent.com/lsst/throughputs/main/sdss/doi_z.dat",
    values: [0.0000283017, 0.000094135, 0.000160068, 0.000245957, 0.000567008, 0.00105846, 0.00218183, 0.00491387, 0.00984273, 0.0172684, 0.0277403, 0.0395303, 0.0514809, 0.0642794, 0.0731593, 0.0789963, 0.0825503, 0.0851139, 0.0864521, 0.0868078, 0.0859211, 0.0839244, 0.081003, 0.0772607, 0.0725956, 0.0637248, 0.0577277, 0.0559739, 0.053226, 0.0503013, 0.0475945, 0.0446207, 0.0360055, 0.0277297, 0.0272532, 0.0255161, 0.0244668, 0.0233557, 0.0239304, 0.0246825, 0.0245668, 0.022062, 0.0206099, 0.0190484, 0.0168397, 0.0145061, 0.0126056, 0.0110897, 0.00950307, 0.00795365, 0.00667315, 0.00559903, 0.00449869, 0.00340853, 0.00274953, 0.00238278, 0.0019828, 0.00162758, 0.0013404, 0.001149, 0.000957528, 0.000728674, 0.000641536, 0.000564145, 0.000478851, 0.000393591, 0.000315027, 0.000202054, 0.000124602, 0.0000478989],
  },
  HST_F275W: {
    id: "HST_F275W",
    label: "HST F275W",
    regime: "uv",
    startNm: 215,
    stepNm: 1,
    lambdaEffNm: 270.803,
    sourceLambdaEffNm: 270.803,
    provenance: {
      instrument: "Hubble Space Telescope",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs HST/WFC3_UVIS2.F275W, HST/ACS_WFC.F606W, HST/ACS_WFC.F814W, HST/WFC3_IR.F160W",
      reference: "Sirianni et al. (2005) PASP 117, 1049 (ACS); Dressel (2023) WFC3 Instrument Handbook",
      note: "TOTAL system throughput including optics and detector, so peaks run 0.13-0.55. No atmosphere, because there is none — which is why HST reaches the near-UV at all.",
      fileHeader: [],
    },
    sourceSha256: "eeb948a0e845d62ebc3c3eb9aaf04068cb02a2024cde9c91974fc6c0b3091493",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=HST/WFC3_UVIS2.F275W",
    values: [0.00001066, 0.0000328811, 0.0000448047, 0.000080389, 0.000143113, 0.00019294, 0.000222273, 0.000287769, 0.000459604, 0.000730019, 0.000948298, 0.00098733, 0.0010161, 0.00126928, 0.00189872, 0.00287023, 0.00369553, 0.00395228, 0.00400669, 0.00442239, 0.00539078, 0.00677047, 0.00811717, 0.00911004, 0.010022, 0.0114757, 0.0140116, 0.018099, 0.0235937, 0.0296508, 0.0354366, 0.0411426, 0.0480462, 0.057457, 0.0695767, 0.082947, 0.0949614, 0.104149, 0.110983, 0.116942, 0.122816, 0.128205, 0.132048, 0.13384, 0.133907, 0.132816, 0.130847, 0.128129, 0.124644, 0.12054, 0.116225, 0.112164, 0.108646, 0.105746, 0.10317, 0.100681, 0.098959, 0.0970132, 0.0948491, 0.0927262, 0.0908899, 0.0893357, 0.087814, 0.0860376, 0.0838537, 0.0812752, 0.078836, 0.0764753, 0.0744151, 0.0728319, 0.0718183, 0.0711872, 0.0706773, 0.0699959, 0.068918, 0.067457, 0.0658856, 0.0642815, 0.0627852, 0.0614389, 0.06016, 0.0588194, 0.0572084, 0.0552425, 0.0530347, 0.0506352, 0.0478786, 0.0447791, 0.040726, 0.0349944, 0.0276288, 0.0198195, 0.0131142, 0.00825554, 0.00509998, 0.00316871, 0.00200328, 0.00129886, 0.000862878, 0.000590824, 0.000411574, 0.000297835, 0.000215803, 0.000152941, 0.00011769, 0.0000907992, 0.0000726973, 0.0000546652, 0.0000461929, 0.0000375356, 0.0000149732],
  },
  HST_F606W: {
    id: "HST_F606W",
    label: "HST F606W",
    regime: "visible",
    startNm: 455,
    stepNm: 5,
    lambdaEffNm: 596.047,
    sourceLambdaEffNm: 596.043,
    provenance: {
      instrument: "Hubble Space Telescope",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs HST/WFC3_UVIS2.F275W, HST/ACS_WFC.F606W, HST/ACS_WFC.F814W, HST/WFC3_IR.F160W",
      reference: "Sirianni et al. (2005) PASP 117, 1049 (ACS); Dressel (2023) WFC3 Instrument Handbook",
      note: "TOTAL system throughput including optics and detector, so peaks run 0.13-0.55. No atmosphere, because there is none — which is why HST reaches the near-UV at all.",
      fileHeader: [],
    },
    sourceSha256: "43cf13219d0db906a2c7ee30541d7ca8e1bf29db13ff8aba245c7a80f04c9462",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=HST/ACS_WFC.F606W",
    values: [0.0000156871, 0.00104831, 0.0232686, 0.0987919, 0.198192, 0.269935, 0.335952, 0.31782, 0.343355, 0.360566, 0.328649, 0.353803, 0.36443, 0.370135, 0.354493, 0.370833, 0.381135, 0.364935, 0.398919, 0.399218, 0.40087, 0.394989, 0.401836, 0.404341, 0.394847, 0.407479, 0.409537, 0.416024, 0.405983, 0.409106, 0.421018, 0.425084, 0.425313, 0.376683, 0.421761, 0.427481, 0.428975, 0.404151, 0.430723, 0.429241, 0.415553, 0.413651, 0.431111, 0.43995, 0.416892, 0.426511, 0.416877, 0.401388, 0.386717, 0.418018, 0.407533, 0.157611, 0.0213143, 0.00214476, 0.000315094, 0.0000143551],
  },
  HST_F814W: {
    id: "HST_F814W",
    label: "HST F814W",
    regime: "nir",
    startNm: 675,
    stepNm: 5,
    lambdaEffNm: 807.306,
    sourceLambdaEffNm: 807.304,
    provenance: {
      instrument: "Hubble Space Telescope",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs HST/WFC3_UVIS2.F275W, HST/ACS_WFC.F606W, HST/ACS_WFC.F814W, HST/WFC3_IR.F160W",
      reference: "Sirianni et al. (2005) PASP 117, 1049 (ACS); Dressel (2023) WFC3 Instrument Handbook",
      note: "TOTAL system throughput including optics and detector, so peaks run 0.13-0.55. No atmosphere, because there is none — which is why HST reaches the near-UV at all.",
      fileHeader: [],
    },
    sourceSha256: "f30fff4530b81308dbec1c32378421a04759994ebc15dbec216c5a0de1012909",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=HST/ACS_WFC.F814W",
    values: [0.00047512, 0.00187786, 0.00348412, 0.0163094, 0.0615331, 0.13038, 0.223707, 0.297854, 0.346715, 0.387733, 0.412576, 0.418087, 0.421853, 0.425956, 0.426668, 0.417838, 0.40493, 0.402476, 0.414853, 0.399744, 0.383999, 0.377699, 0.382541, 0.380506, 0.371081, 0.362792, 0.356764, 0.353197, 0.342811, 0.335906, 0.329743, 0.320226, 0.31254, 0.307013, 0.298733, 0.290563, 0.286513, 0.277017, 0.267725, 0.257515, 0.248529, 0.242258, 0.234963, 0.223144, 0.211378, 0.204856, 0.196077, 0.186746, 0.178905, 0.173249, 0.167052, 0.15952, 0.150561, 0.138957, 0.125564, 0.117016, 0.0861695, 0.0186089, 0.00191849, 0.000393918, 0.000184438, 0.0000112265],
  },
  HST_F160W: {
    id: "HST_F160W",
    label: "HST F160W",
    regime: "nir",
    startNm: 1365,
    stepNm: 5,
    lambdaEffNm: 1539.23,
    sourceLambdaEffNm: 1539.23,
    provenance: {
      instrument: "Hubble Space Telescope",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs HST/WFC3_UVIS2.F275W, HST/ACS_WFC.F606W, HST/ACS_WFC.F814W, HST/WFC3_IR.F160W",
      reference: "Sirianni et al. (2005) PASP 117, 1049 (ACS); Dressel (2023) WFC3 Instrument Handbook",
      note: "TOTAL system throughput including optics and detector, so peaks run 0.13-0.55. No atmosphere, because there is none — which is why HST reaches the near-UV at all.",
      fileHeader: [],
    },
    sourceSha256: "493303a09f85bd57769ae4766950b9f3cbce93874c07758d3fe69cec122bc230",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=HST/WFC3_IR.F160W",
    values: [0.0000384775, 0.000327652, 0.000721153, 0.0019262, 0.00528703, 0.0185379, 0.0849698, 0.295054, 0.475414, 0.501504, 0.5036, 0.518417, 0.537796, 0.546672, 0.547714, 0.549561, 0.550556, 0.546983, 0.541261, 0.539503, 0.544719, 0.549785, 0.546952, 0.536527, 0.527182, 0.525742, 0.531721, 0.540127, 0.545129, 0.546751, 0.545151, 0.538924, 0.52932, 0.517813, 0.510487, 0.510804, 0.516768, 0.523024, 0.524947, 0.524026, 0.522914, 0.523271, 0.522643, 0.519786, 0.516442, 0.513469, 0.51091, 0.505998, 0.498429, 0.492386, 0.49042, 0.49183, 0.490299, 0.481527, 0.467854, 0.458971, 0.463149, 0.474184, 0.47622, 0.465979, 0.45371, 0.448017, 0.433733, 0.408821, 0.343186, 0.138958, 0.0273517, 0.00587213, 0.00169178, 0.000530815, 0.000213505, 0.0000729478],
  },
  JWST_F090W: {
    id: "JWST_F090W",
    label: "JWST F090W",
    regime: "nir",
    startNm: 785,
    stepNm: 5,
    lambdaEffNm: 904.228,
    sourceLambdaEffNm: 904.228,
    provenance: {
      instrument: "James Webb Space Telescope",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs JWST/NIRCam.F090W, JWST/NIRCam.F200W, JWST/NIRCam.F444W, JWST/MIRI.F770W",
      reference: "Rieke et al. (2023) PASP 135, 028001 (NIRCam); Wright et al. (2023) PASP 135, 048003 (MIRI)",
      note: "TOTAL system throughput. F770W reaches 7.7 um, extending the baseline here by nearly a decade in wavelength — the regime where embedded and heavily reddened stars are actually observed.",
      fileHeader: [],
    },
    sourceSha256: "b5c713b0550542943bb304fb0834c738a2dee51b428c241ba0a114adeb9b7f18",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=JWST/NIRCam.F090W",
    values: [0.00051874, 0.0244637, 0.156267, 0.246339, 0.258317, 0.248138, 0.253488, 0.266487, 0.273553, 0.269235, 0.267682, 0.274414, 0.280561, 0.281597, 0.281636, 0.281487, 0.283287, 0.290271, 0.292436, 0.289865, 0.28512, 0.290297, 0.298686, 0.29464, 0.287826, 0.289348, 0.301959, 0.311397, 0.307318, 0.302125, 0.301443, 0.302635, 0.309245, 0.309096, 0.30467, 0.304218, 0.311039, 0.31531, 0.31298, 0.306733, 0.310959, 0.317935, 0.315053, 0.294136, 0.165643, 0.0625287, 0.0283861, 0.0118131, 0.00270673, 0.000518544, 0.0000966085],
  },
  JWST_F200W: {
    id: "JWST_F200W",
    label: "JWST F200W",
    regime: "nir",
    startNm: 1690,
    stepNm: 10,
    lambdaEffNm: 1993.39,
    sourceLambdaEffNm: 1993.39,
    provenance: {
      instrument: "James Webb Space Telescope",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs JWST/NIRCam.F090W, JWST/NIRCam.F200W, JWST/NIRCam.F444W, JWST/MIRI.F770W",
      reference: "Rieke et al. (2023) PASP 135, 028001 (NIRCam); Wright et al. (2023) PASP 135, 048003 (MIRI)",
      note: "TOTAL system throughput. F770W reaches 7.7 um, extending the baseline here by nearly a decade in wavelength — the regime where embedded and heavily reddened stars are actually observed.",
      fileHeader: [],
    },
    sourceSha256: "af30f31d7e8df1dd950bfe8ac47053a33428149830c20884f64523ba9d01d6f8",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=JWST/NIRCam.F200W",
    values: [0.0000619796, 0.000283643, 0.000960612, 0.00343245, 0.0149977, 0.0514409, 0.159133, 0.335537, 0.433216, 0.459183, 0.461979, 0.454506, 0.447089, 0.454321, 0.463532, 0.466842, 0.463326, 0.458363, 0.458076, 0.464221, 0.469577, 0.472497, 0.47607, 0.476466, 0.473451, 0.4705, 0.473511, 0.473833, 0.476066, 0.475899, 0.478018, 0.478422, 0.478517, 0.480688, 0.48609, 0.486484, 0.480919, 0.480345, 0.48718, 0.49249, 0.491091, 0.487127, 0.483563, 0.481278, 0.480862, 0.483594, 0.487895, 0.48529, 0.478082, 0.474756, 0.477783, 0.484238, 0.474251, 0.36887, 0.184411, 0.0688354, 0.0190227, 0.00488675, 0.0013748, 0.000480958, 0.000204828, 0.0000444749],
  },
  JWST_F444W: {
    id: "JWST_F444W",
    label: "JWST F444W",
    regime: "nir",
    startNm: 3720,
    stepNm: 20,
    lambdaEffNm: 4415.98,
    sourceLambdaEffNm: 4415.97,
    provenance: {
      instrument: "James Webb Space Telescope",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs JWST/NIRCam.F090W, JWST/NIRCam.F200W, JWST/NIRCam.F444W, JWST/MIRI.F770W",
      reference: "Rieke et al. (2023) PASP 135, 028001 (NIRCam); Wright et al. (2023) PASP 135, 048003 (MIRI)",
      note: "TOTAL system throughput. F770W reaches 7.7 um, extending the baseline here by nearly a decade in wavelength — the regime where embedded and heavily reddened stars are actually observed.",
      fileHeader: [],
    },
    sourceSha256: "536e933bfe6337b442ce11df9051b4c38b275b306e2b54008bf2fced1c41ebae",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=JWST/NIRCam.F444W",
    values: [0.000136937, 0.000385254, 0.000957233, 0.00222218, 0.00504466, 0.0125095, 0.0359082, 0.107789, 0.253883, 0.39635, 0.467394, 0.49342, 0.500998, 0.503908, 0.505349, 0.507247, 0.508941, 0.510469, 0.512223, 0.512847, 0.513604, 0.513912, 0.514436, 0.51349, 0.512535, 0.511576, 0.510573, 0.508436, 0.498141, 0.508214, 0.506742, 0.504914, 0.50322, 0.499629, 0.495746, 0.493621, 0.491678, 0.489887, 0.488453, 0.486502, 0.483183, 0.479114, 0.474931, 0.471402, 0.46694, 0.461888, 0.455309, 0.44829, 0.44138, 0.436254, 0.433005, 0.430313, 0.426677, 0.42187, 0.416897, 0.412896, 0.408517, 0.402462, 0.39354, 0.381117, 0.36844, 0.352732, 0.323714, 0.274369, 0.212672, 0.152999, 0.102483, 0.0621465, 0.0325566, 0.00886975],
  },
  JWST_F770W: {
    id: "JWST_F770W",
    label: "JWST F770W",
    regime: "mir",
    startNm: 6200,
    stepNm: 40,
    lambdaEffNm: 7663.45,
    sourceLambdaEffNm: 7663.46,
    provenance: {
      instrument: "James Webb Space Telescope",
      upstream: "SVO Filter Profile Service (https://svo2.cab.inta-csic.es/theory/fps/), filter IDs JWST/NIRCam.F090W, JWST/NIRCam.F200W, JWST/NIRCam.F444W, JWST/MIRI.F770W",
      reference: "Rieke et al. (2023) PASP 135, 028001 (NIRCam); Wright et al. (2023) PASP 135, 048003 (MIRI)",
      note: "TOTAL system throughput. F770W reaches 7.7 um, extending the baseline here by nearly a decade in wavelength — the regime where embedded and heavily reddened stars are actually observed.",
      fileHeader: [],
    },
    sourceSha256: "8f0af0ce8ce53b4b2999072a2b23676338c76bfb14ce9e6382ce579bb805010e",
    readFrom: "https://svo2.cab.inta-csic.es/theory/fps/getdata.php?format=ascii&id=JWST/MIRI.F770W",
    values: [0.000025, 0.000346875, 0.0006275, 0.00015, 0.000159375, 0.000330208, 0.00107292, 0.00635312, 0.049741, 0.16004, 0.221777, 0.293496, 0.29942, 0.280641, 0.304769, 0.348606, 0.35767, 0.342765, 0.331946, 0.338543, 0.345195, 0.359031, 0.36746, 0.371594, 0.368746, 0.365633, 0.371641, 0.37891, 0.37385, 0.364725, 0.364628, 0.37699, 0.386476, 0.37982, 0.36814, 0.364057, 0.3706, 0.380973, 0.386514, 0.387374, 0.387991, 0.389882, 0.3893, 0.384907, 0.382434, 0.386265, 0.393131, 0.396418, 0.393643, 0.389422, 0.389089, 0.392014, 0.392819, 0.388387, 0.382137, 0.379275, 0.381369, 0.38497, 0.385184, 0.380316, 0.370111, 0.33168, 0.220971, 0.0923823, 0.0292073, 0.00963417, 0.00369417, 0.00166542, 0.000881875, 0.000517708, 0.000382292, 0.0003, 0.0003, 0.0003, 0.0003, 0.000217708, 0.000146875, 0.0001, 0.000075],
  },
};
