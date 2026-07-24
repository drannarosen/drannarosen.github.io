/*
 * schemes.ts — named ways to map a star's temperature to a colour (Layer 0).
 *
 * One physical truth, several presentations. True colour is the honest baseline
 * and it is SUBTLE: across the whole stellar range, blackbody chromaticities
 * trace a short arc of CIE space, so a real cluster is mostly white-ish with
 * restrained warm and cool tints. Astronomical images look vivid because they
 * are deliberately chroma-stretched or built from band composites, not because
 * stars are saturated.
 *
 * Every scheme here therefore declares whether it is PHYSICAL (a faithful colour
 * a camera could record), STRETCHED (physical hue, exaggerated chroma) or
 * SCHEMATIC (a designed palette that encodes a quantity, i.e. false colour).
 * That label travels with the scheme so a page can caption it honestly rather
 * than implying a designed palette is a measurement.
 *
 * Note what is NOT here: nothing invents a colour. The schematic palettes are
 * DERIVED from the blackbody colour at each spectral class's anchor temperature
 * and then pushed toward the gamut edge, so even the vivid presentations trace
 * back to physics rather than to taste.
 */

import { blackbodyLinearRGB, normalizeChroma } from "./index.ts";
import { spectralType } from "../stellar/index.ts";

export type SchemeKind = "physical" | "stretched" | "schematic";

export interface ColorScheme {
  /** Stable id for URLs, controls and tests. */
  id: string;
  /** Short human label for a control. */
  label: string;
  /** What kind of claim this presentation makes. */
  kind: SchemeKind;
  /** One line a page can show as a caption. */
  note: string;
  /** Teff [K] -> LINEAR sRGB, peak-normalized to 1. */
  color(teffK: number): [number, number, number];
}

/** Rec. 601 luma — the grey axis a chroma stretch pushes away from. */
const luma = (c: readonly [number, number, number]): number =>
  0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/**
 * Push a colour away from its own grey by `amount`, preserving hue.
 *
 * Renormalized afterwards so the result stays a pure chromaticity: without that,
 * stretching changes overall brightness too and colour stops being independent
 * of flux, which the whole pipeline depends on.
 */
export function stretchChroma(
  c: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  const lum = luma(c);
  return normalizeChroma([
    lum + (c[0] - lum) * amount,
    lum + (c[1] - lum) * amount,
    lum + (c[2] - lum) * amount,
  ]);
}

/**
 * The MK classes, hot to cool, each with the anchor temperature `core/stellar`
 * already uses for classification. Colours are DERIVED from these temperatures,
 * never chosen by eye.
 */
const CLASS_ANCHORS: Array<[cls: string, teffK: number]> = [
  ["O", 40000],
  ["B", 20000],
  ["A", 8800],
  ["F", 6800],
  ["G", 5800],
  ["K", 4500],
  ["M", 3200],
];

/** First letter of the MK type for a temperature, via core/stellar. */
function classOf(teffK: number): string {
  return spectralType(teffK).charAt(0);
}

/**
 * Fully-saturated colour for each MK class: the class anchor's blackbody colour
 * pushed to the gamut edge. Derived once, at module load.
 */
const CLASS_COLORS = new Map<string, [number, number, number]>(
  CLASS_ANCHORS.map(([cls, T]) => [cls, stretchChroma(blackbodyLinearRGB(T), 6)]),
);

const FALLBACK: [number, number, number] = [1, 1, 1];

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: "true",
    label: "True colour",
    kind: "physical",
    note: "Blackbody spectrum integrated against the CIE 1931 observer. Faithful, and deliberately subtle — real stars are mostly white-ish.",
    color: (T) => blackbodyLinearRGB(T),
  },
  {
    id: "stretched",
    label: "Stretched",
    kind: "stretched",
    note: "True hue, chroma boosted 2.4x — the look of a stretched multi-band cluster image. Hue is physical; saturation is a choice.",
    color: (T) => stretchChroma(blackbodyLinearRGB(T), 2.4),
  },
  {
    id: "vivid",
    label: "Vivid",
    kind: "stretched",
    note: "True hue, chroma boosted 5x. Maximum separation between stars while every hue still traces to its blackbody colour.",
    color: (T) => stretchChroma(blackbodyLinearRGB(T), 5),
  },
  {
    id: "class",
    label: "Spectral class",
    kind: "schematic",
    note: "One saturated colour per MK class (O B A F G K M), derived from each class's anchor temperature. False colour: it encodes classification, not appearance.",
    color: (T) => CLASS_COLORS.get(classOf(T)) ?? FALLBACK,
  },
];

/** Look up a scheme by id, falling back to true colour. */
export function getScheme(id: string): ColorScheme {
  return COLOR_SCHEMES.find((s) => s.id === id) ?? COLOR_SCHEMES[0]!;
}
