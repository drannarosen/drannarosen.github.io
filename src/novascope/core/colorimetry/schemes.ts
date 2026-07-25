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
 * Note what is NOT here: nothing invents a colour. Every scheme is DERIVED — the
 * physical ones by integrating a blackbody against the CIE observer, the stretched
 * one by pushing that same colour away from its own grey, the schematic ones by
 * assigning real band fluxes to channels. There is no hand-picked palette, and the
 * two schemes that came closest to being one were removed (see below).
 */

import { blackbodyLinearRGB, normalizeChroma } from "./index.ts";
import { bandIntegral, type BandComposite } from "../photometry/passbands.ts";
import { ALL_COMPOSITES } from "../photometry/instruments.ts";
import { spectralType } from "../stellar/index.ts";
import { planckNm } from "../blackbody/index.ts";

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


/*
 * MK class anchors, and the saturated colour each gets.
 *
 * Anchor temperatures are the midpoints `core/stellar`'s `spectralType` would assign, so the
 * mapping is DERIVED from the classifier rather than chosen by eye — a class's colour and its
 * name cannot disagree.
 *
 * These were briefly deleted along with `vivid` and then wanted back. Restored rather than
 * reinvented: the point of `class` is that it is deliberately NOT photometric, and it is the
 * clearest way to see that a spectral class is a bin, not a colour.
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

/** Each class anchor's blackbody colour pushed to the gamut edge. Derived once, at module load. */
const CLASS_COLORS = new Map<string, [number, number, number]>(
  CLASS_ANCHORS.map(([cls, T]) => [cls, stretchChroma(blackbodyLinearRGB(T), 6)]),
);

/** White, for a temperature outside every anchor's reach. Never expected; not silently wrong. */
const CLASS_FALLBACK: [number, number, number] = [1, 1, 1];

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
    note: "True hue, chroma boosted 5x. Maximum separation between stars while every hue still traces to its blackbody colour — the most colour this cluster can be given without inventing any.",
    color: (T) => stretchChroma(blackbodyLinearRGB(T), 5),
  },
  {
    id: "class",
    label: "Spectral class",
    kind: "schematic",
    note: "One saturated colour per MK class (O B A F G K M), derived from each class's anchor temperature. False colour: it encodes CLASSIFICATION, not appearance, so two stars 900 K apart can share a colour while two 100 K apart do not.",
    color: (T) => CLASS_COLORS.get(classOf(T)) ?? CLASS_FALLBACK,
  },
];

/*
 * REMOVED: `vivid` (chroma x5) and `class` (one saturated colour per MK class).
 *
 * Both were dropped deliberately, not lost. Rendered on the real cluster they read
 * as decoration rather than as measurement: x5 chroma pushes every star to the
 * gamut edge, so the image asserts a colour difference far larger than the physics
 * supports, and a per-class palette replaces a continuous physical quantity with
 * seven arbitrary buckets. On a page whose whole claim is that what you see traces
 * to a cited relation, a presentation that overstates its own evidence costs more
 * credibility than it buys legibility.
 *
 * `stretchChroma` itself is KEPT — `stretched` uses it at 2.4x, and it is the honest
 * middle: hue stays physical and only saturation is a choice. If a schematic
 * classification view is ever wanted again it belongs in a diagram, labelled as
 * schematic, not in the photometric renderer.
 */

/**
 * Colour from a three-band composite: each channel is the star's flux through
 * one filter, exactly as an astronomical colour image is assembled.
 *
 * This is a genuinely different route to colour from the schemes above. Those
 * integrate the whole visible spectrum against the human observer; this samples
 * three filters and assigns them to channels, so it can show light the eye
 * cannot see. Channels are normalized to their peak, keeping colour independent
 * of flux like every other scheme.
 *
 * The RATIOS come from physics — a cool star really is far brighter in K than in
 * V — so the strong colour separation here is earned rather than dialled in.
 */
export function compositeColor(teffK: number, composite: BandComposite): [number, number, number] {
  const spectrum = (l: number): number => planckNm(l, teffK);
  const [r, g, b] = composite.bands.map((band) => bandIntegral(spectrum, band));
  return normalizeChroma([r ?? 0, g ?? 0, b ?? 0]);
}

/** Composite schemes, derived from the shared band definitions. */
const COMPOSITE_SCHEMES: ColorScheme[] = ALL_COMPOSITES.map((c) => ({
  id: `band-${c.id}`,
  label: c.label,
  /* Only the Johnson-Cousins composite approximates what a person would see; every other one
   * is false colour in the ordinary astronomical sense — a real and standard way to show light
   * the eye cannot receive, but not a photograph of what is there. The id changed from
   * "visible" to "johnson" when composites moved to `core/photometry/instruments`, and it says
   * more: what makes it near-true-colour is that it IS the visual system, not a label. */
  kind: c.id === "johnson" ? "physical" : "schematic",
  note: c.note,
  color: (T: number) => compositeColor(T, c),
}));

COLOR_SCHEMES.push(...COMPOSITE_SCHEMES);

/** Look up a scheme by id, falling back to true colour. */
export function getScheme(id: string): ColorScheme {
  return COLOR_SCHEMES.find((s) => s.id === id) ?? COLOR_SCHEMES[0]!;
}
