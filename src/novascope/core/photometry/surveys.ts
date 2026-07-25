/*
 * surveys.ts — published survey depths and instrument key numbers (Layer 0, pure).
 *
 * REFERENCE DATA, not a model. These are apparent AB magnitudes as published, kept
 * so a page can say "Rubin reaches r = 24.0 in a single visit" and cite it, and so
 * a depth control can be labelled against real instruments instead of an abstract
 * scale.
 *
 * WHAT THIS CANNOT DO, stated up front because the temptation is obvious. The
 * renderer's depth is expressed in MAGNITUDES BELOW ITS OWN WHITE POINT, and
 * `core/photometry` has no absolute zero point — `bandFlux` returns arbitrary but
 * self-consistent units, and the only calibrated magnitude scale available is the
 * IAU bolometric one. So a value here CANNOT be fed to the renderer as a limit:
 * "set the depth to Rubin's r = 24.0" is not a computation this package can do.
 *
 * Making it possible is a real and worthwhile piece of work — it needs f_nu in
 * erg/s/cm^2/Hz through each curve against the AB zero point (3.631e-9), which the
 * tabulated curves now make tractable. Until then these numbers are for LABELLING
 * and COMPARISON, and any page using them must not imply the render is calibrated
 * to them.
 */

export interface SurveyBandDepth {
  /** Band id, matching `PASSBANDS`. */
  band: string;
  /** 5-sigma point-source depth for one standard visit [AB mag]. */
  singleVisit: number;
  /** 5-sigma point-source depth for the full-survey coadd [AB mag]. */
  coadd: number;
}

export interface SurveyReference {
  id: string;
  label: string;
  /** Where every number in this record came from. */
  source: string;
  /** Depths per band, faintest-limit magnitudes. */
  depths: SurveyBandDepth[];
  /** Free-form key numbers worth quoting, as label/value pairs. */
  keyNumbers: Array<[label: string, value: string]>;
}

/**
 * Rubin Observatory / LSST.
 *
 * Every figure transcribed from the observatory's own "Key Numbers" page, which is
 * the current authority and is what should be quoted.
 *
 * NOTE A DISAGREEMENT, deliberately recorded rather than resolved. fluxax's
 * `instruments/rubin/filters.py` carries different depths, citing Ivezic et al.
 * (2019) and the LSST Science Book:
 *
 *     band   Rubin page (single / coadd)   fluxax (single / coadd)
 *     u      23.8 / 25.6                   23.7 / 26.1
 *     g      24.5 / 26.9                   24.8 / 27.4
 *     r      24.0 / 26.9                   24.5 / 27.5
 *     i      23.4 / 26.4                   23.9 / 26.8
 *     z      22.7 / 25.6                   23.3 / 26.1
 *     y      22.0 / 24.8                   22.1 / 24.9
 *
 * Up to 0.6 mag apart, and the coadds differ systematically — the older references
 * assumed a different visit count and survey model. This module follows the
 * observatory page; anything comparing against fluxax must expect the offset rather
 * than treat either as wrong.
 */
export const RUBIN: SurveyReference = {
  id: "rubin",
  label: "Rubin / LSST",
  source: "Rubin Observatory, Rubin 101 Key Numbers (rubinobservatory.org), retrieved 2026-07-24",
  depths: [
    { band: "LSST_u", singleVisit: 23.8, coadd: 25.6 },
    { band: "LSST_g", singleVisit: 24.5, coadd: 26.9 },
    { band: "LSST_r", singleVisit: 24.0, coadd: 26.9 },
    { band: "LSST_i", singleVisit: 23.4, coadd: 26.4 },
    { band: "LSST_z", singleVisit: 22.7, coadd: 25.6 },
    { band: "LSST_y", singleVisit: 22.0, coadd: 24.8 },
  ],
  keyNumbers: [
    ["Primary mirror", "8.4 m"],
    ["Field of view", "3.5 deg (9.6 deg²)"],
    ["Pixel scale", "0.2 arcsec/pixel"],
    ["Camera", "3.2 Gpixel, 189 4k×4k CCDs"],
    ["Standard visit", "30 s"],
    ["Survey duration", "10 years"],
    ["Visits per pointing", "800 (fiducial)"],
    ["Main survey area", "18,000 deg²"],
    ["Final data products", "20B galaxies, 17B resolved stars"],
  ],
};

/**
 * Gaia DR3.
 *
 * Gaia's limit is a completeness limit rather than a per-visit 5-sigma depth, so the
 * two depth fields carry the same value: there is no coadd in the Rubin sense. It is
 * recorded this way rather than left blank so a consumer iterating over surveys does
 * not need a special case, and the note says why they match.
 */
export const GAIA: SurveyReference = {
  id: "gaia",
  label: "Gaia DR3",
  source: "Gaia Collaboration, DR3 documentation; photometric system Riello et al. (2021) A&A 649, A3",
  depths: [
    { band: "Gaia_G", singleVisit: 20.7, coadd: 20.7 },
    { band: "Gaia_BP", singleVisit: 20.3, coadd: 20.3 },
    { band: "Gaia_RP", singleVisit: 20.0, coadd: 20.0 },
  ],
  keyNumbers: [
    ["Sources", "~1.8 billion"],
    ["Limiting magnitude", "G ≈ 20.7"],
    ["Bright limit", "G ≈ 3"],
  ],
};

export const SURVEYS: SurveyReference[] = [RUBIN, GAIA];

/** The faintest and brightest depths across every recorded survey [AB mag]. */
export function depthRange(): { faintest: number; brightest: number } {
  const all = SURVEYS.flatMap((s) => s.depths.flatMap((d) => [d.singleVisit, d.coadd]));
  return { faintest: Math.max(...all), brightest: Math.min(...all) };
}
