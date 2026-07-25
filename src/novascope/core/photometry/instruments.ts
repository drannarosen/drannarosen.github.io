/*
 * instruments.ts — what an instrument IS, for imaging purposes (Layer 0, pure).
 *
 * An instrument here is three things: which three bands make its colour composite, which band
 * sets brightness when only one is used, and — where such a thing genuinely exists — the
 * published survey depth it reaches. Nothing more; this is not a telescope model.
 *
 * WHY IT IS ONE RECORD RATHER THAN THREE LISTS. Before this, a page chose a brightness band from
 * `PASSBANDS` and a colour composite from `BAND_COMPOSITES` independently, which made it possible
 * — and easy — to display Rubin r brightness through a 2MASS K/H/J composite. That image is not
 * of anything. Binding the three together means selecting an instrument selects a consistent set.
 *
 * COMPOSITES ARE ORDERED LONGEST TO SHORTEST WAVELENGTH, mapping to red, green, blue. That is the
 * astronomical convention and it is the one thing here a reversed entry would break while still
 * producing a plausible image, so `check:star-optics` asserts the ordering from the curves' own
 * effective wavelengths rather than trusting the list.
 *
 * DEPTHS ARE OPTIONAL AND THAT IS THE POINT. Rubin and Gaia are surveys with published 5-sigma
 * point-source limits. HST and JWST are POINTED telescopes: their depth is whatever the observer
 * integrated for, so there is no single number, and inventing one to make the record uniform would
 * be exactly the fabrication this repository's rules forbid. A consumer must therefore handle
 * `survey: undefined` rather than assume every instrument has a limit.
 */

import { PASSBANDS, type BandComposite } from "./passbands.ts";

export interface Instrument {
  id: string;
  label: string;
  /**
   * Three band ids mapped to red, green and blue — longest to shortest wavelength.
   *
   * Chosen to be what that instrument's own colour images are conventionally made from: Rubin and
   * SDSS use i/r/g, Gaia has only its three bands, HST and JWST use a wide/medium/short trio from
   * the same camera where possible.
   */
  composite: readonly [string, string, string];
  /** Band that sets brightness in single-band mode — the instrument's workhorse filter. */
  brightnessBand: string;
  /**
   * `SurveyReference.id` in `./surveys`, for instruments that publish a depth. Absent for pointed
   * telescopes, which do not have one — see the header.
   */
  survey?: string;
  /** What this instrument shows that the others do not. */
  note: string;
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: "johnson",
    label: "Johnson–Cousins",
    composite: ["R", "V", "B"],
    brightnessBand: "V",
    note: "The classical visual system, and the closest of these to what a colour camera records. FILTER transmission only — no telescope, detector or atmosphere — because that is the generic system synthetic UBVRI colours are defined on.",
  },
  {
    id: "2mass",
    label: "2MASS",
    composite: ["K", "H", "J"],
    brightnessBand: "K",
    note: "Near-infrared. Cool stars dominate here because this is where their light actually is, so it inverts which stars look prominent relative to a visual composite.",
  },
  {
    id: "sdss",
    label: "SDSS",
    composite: ["SDSS_i", "SDSS_r", "SDSS_g"],
    brightnessBand: "SDSS_r",
    note: "Rubin's direct ancestor and the survey the AB system is most associated with. As-measured responses at 1.3 airmasses.",
  },
  {
    id: "rubin",
    label: "Rubin / LSST",
    composite: ["LSST_i", "LSST_r", "LSST_g"],
    brightnessBand: "LSST_r",
    survey: "rubin",
    note: "TOTAL system throughput — atmosphere, optics, filter and detector — so the curves peak near 0.6 rather than 1. The deepest wide survey depths here by a wide margin.",
  },
  {
    id: "gaia",
    label: "Gaia DR3",
    composite: ["Gaia_RP", "Gaia_G", "Gaia_BP"],
    brightnessBand: "Gaia_G",
    survey: "gaia",
    note: "Only three bands, and G is exceptionally wide (~730 nm), so its composite has far less colour leverage than a four-filter system. Its shallow limit is what makes low-mass stars vanish.",
  },
  {
    id: "hst",
    label: "HST",
    composite: ["HST_F814W", "HST_F606W", "HST_F275W"],
    brightnessBand: "HST_F606W",
    note: "No atmosphere, so F275W reaches the near-ultraviolet that no ground-based band here can. A young cluster is dominated by its O stars in this composite, which is why it comes out strongly blue — that is the physics, not a bias.",
  },
  {
    id: "jwst",
    label: "JWST",
    composite: ["JWST_F444W", "JWST_F200W", "JWST_F090W"],
    brightnessBand: "JWST_F200W",
    note: "Reaches 4.4 um in this composite and 7.7 um in F770W — the regime where embedded and heavily reddened stars are actually observed, and the one that will matter most once extinction is modelled.",
  },
];

/** Look up an instrument by id. */
export function getInstrument(id: string): Instrument | null {
  return INSTRUMENTS.find((i) => i.id === id) ?? null;
}

/**
 * Every instrument's composite, as a `BandComposite`.
 *
 * DERIVED from `INSTRUMENTS` rather than listed again, so a composite cannot disagree with the
 * instrument it belongs to. This is the one home for composites: `passbands.ts` used to carry its
 * own `BAND_COMPOSITES` array, two of whose three entries were secretly instrument composites
 * (`visible` was Johnson R/V/B and `nir` was 2MASS K/H/J) under names that did not say so.
 */
export const INSTRUMENT_COMPOSITES: BandComposite[] = INSTRUMENTS.map((i) => ({
  id: i.id,
  label: i.label,
  bands: [PASSBANDS[i.composite[0]]!, PASSBANDS[i.composite[1]]!, PASSBANDS[i.composite[2]]!],
  note: i.note,
}));

/**
 * The one composite that is NOT an instrument: near-infrared to ultraviolet, across the widest
 * baseline these curves span.
 *
 * Kept separate and named for what it is. No telescope takes this image — K, V and U come from
 * three different systems — so presenting it beside the instrument composites without saying so
 * would imply a measurement that nobody made. It is here because it is the most
 * temperature-sensitive composite available and therefore the most useful for showing what colour
 * MEANS, which is a teaching purpose rather than an observational one.
 */
export const BASELINE_COMPOSITE: BandComposite = {
  id: "wide-baseline",
  label: "Wide baseline (K/V/U)",
  bands: [PASSBANDS.K!, PASSBANDS.V!, PASSBANDS.U!],
  note: "Near-infrared to ultraviolet, spanning the widest baseline available. NOT an instrument — these three filters belong to three different systems, so no telescope produces this image. The most temperature-sensitive composite here.",
};

/** Instrument composites plus the one cross-instrument baseline, for a UI that offers all of them. */
export const ALL_COMPOSITES: BandComposite[] = [...INSTRUMENT_COMPOSITES, BASELINE_COMPOSITE];
