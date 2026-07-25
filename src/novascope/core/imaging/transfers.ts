/*
 * transfers.ts — the one registry of display conventions (Layer 0, pure).
 *
 * WHAT PROBLEM THIS SOLVES. The renderer had two unrelated ways of deciding how a linear
 * radiance becomes a pixel: `luptonNode`/`createStretchNode` built a TSL output node, while
 * three's tone mappers were applied by setting `renderer.toneMapping` and calling
 * `.renderOutput()`. Two mechanisms behind what is, to anyone using the page, ONE question —
 * "which display convention is this image drawn under?" — so the control could only ever offer
 * half the answer, and the half it offered depended on which mechanism the last commit happened
 * to use. That is how AgX ended up existing only in a comment.
 *
 * It turns out there is no second mechanism. Three's tone mappers are exported from `three/tsl`
 * as ordinary TSL functions of `(vec3 color, float exposure)`; `renderer.toneMapping` plus
 * `renderOutput()` is a convenience wrapper that calls them and then applies the output colour
 * transform. So all of them can be output nodes in one graph, `NoToneMapping` stays set, and
 * this file is the single list of what exists. `viz/starfield/transferNode` builds whichever one
 * is named; nothing else switches on the family.
 *
 * ── THE ONE DISTINCTION THAT IS REAL, AND MUST NOT BE HIDDEN ──
 *
 * The families differ in what their output MEANS, and getting it wrong is invisible in code
 * review and obvious on screen:
 *
 *   - ASTRONOMICAL (`lupton` and the five astropy stretches) is DISPLAY-REFERRED. The number
 *     coming out is the pixel value. astropy writes `make_lupton_rgb`'s result straight to a
 *     PNG, which is exactly what that means. Applying an sRGB encode on top encodes twice and
 *     washes the image out.
 *   - PHOTOGRAPHIC (three's six operators) is SCENE-REFERRED. The number coming out is display-
 *     LINEAR and still needs the sRGB encode — which is precisely what `renderOutput()` does
 *     and why omitting it leaves a crushed, under-exposed-looking image.
 *
 * So `encoding` is recorded per transfer and the node factory reads it. It is also worth SAYING
 * on the page, because it is the honest answer to "why does astronomy not just use AgX": the
 * two families disagree about whose job the encode is, and an astronomical curve is designed to
 * be looked at directly.
 *
 * DERIVED FROM THE TWO SOURCE MODULES, not retyped. The astropy entries take their notes from
 * `STRETCH_NOTES` and the photographic ones from `TONE_MAP_NOTES`, so a curve's description has
 * one home and a new curve appears here by existing rather than by being remembered.
 */
import { STRETCH_IDS, STRETCH_NOTES, stretch, stretchInverse, type StretchId } from "./stretch.ts";
import {
  TONE_MAP_IDS,
  TONE_MAP_NOTES,
  toneMapFloor,
  toneMapGrey,
  type ToneMapId,
} from "./toneMap.ts";
import {
  ONE_DISPLAY_LEVEL,
  luptonIntensityForOutput,
  luptonQForDepth,
  luptonStretchForWhite,
  luptonStretchedIntensity,
} from "./lupton.ts";

/**
 * Which display convention an image is drawn under.
 *
 * `lupton` first because it is the only three-channel one and the only one that preserves hue
 * through saturation; then the astropy scalar curves; then the photographic operators.
 */
export const TRANSFER_IDS = ["lupton", ...STRETCH_IDS, ...TONE_MAP_IDS] as const;
export type TransferId = (typeof TRANSFER_IDS)[number];

/**
 * What the output of a transfer already is.
 *
 * `display-referred` — the value IS the pixel; no further encode. `scene-linear` — the value is
 * display-linear and the sRGB encode still has to be applied.
 */
export type TransferEncoding = "display-referred" | "scene-linear";

/** Which tradition a transfer comes from. Not cosmetic — it is why the encodings differ. */
export type TransferFamily = "astronomical" | "photographic";

export interface TransferRecord {
  id: TransferId;
  label: string;
  family: TransferFamily;
  encoding: TransferEncoding;
  /**
   * Whether the transfer scales all three channels by ONE common factor.
   *
   * The property that decides whether a bright star keeps its colour. Lupton is the only
   * transfer here for which it is exactly true, and that is the whole reason the algorithm
   * exists — measured, its hue drifts 1.1e-16 over seven decades of intensity. Every scalar
   * curve applied per channel fails it by construction: the channels clip at different inputs,
   * so a saturated star drifts to white. `neutral` is the interesting near-miss — it compresses
   * only the peak channel — but it then desaturates deliberately, so it is not common-mode
   * either.
   */
  huePreserving: boolean;
  note: string;
}

/**
 * Display names, one per transfer and exhaustive by type.
 *
 * A `Record<TransferId, string>` rather than a switch with a `default`, on purpose: a default
 * arm would silently hand a new transfer its bare id as a label, so the omission would ship
 * looking deliberate. As a total record, adding an id fails the type check until it is named.
 *
 * The astropy curves keep their lowercase mathematical names — `sqrt`, `asinh` — because that is
 * what astropy calls them and what a reader will search for. The photographic operators get their
 * proper names for the same reason.
 */
const TRANSFER_LABELS: Record<TransferId, string> = {
  lupton: "Lupton — hue-preserving, 3-channel",
  linear: "linear — no compression",
  sqrt: "sqrt — classical photographic",
  asinh: "asinh — astropy default",
  log: "log — aggressive",
  sinh: "sinh — suppresses faint detail",
  agx: "AgX",
  neutral: "Khronos PBR Neutral",
  aces: "ACES Filmic",
  reinhard: "Reinhard",
  cineon: "Cineon",
  srgb: "sRGB encode only (no curve)",
};

const STRETCH_SET: ReadonlySet<string> = new Set(STRETCH_IDS);
const TONE_MAP_SET: ReadonlySet<string> = new Set(TONE_MAP_IDS);

/*
 * TYPE GUARDS, not casts.
 *
 * `TransferId` is the union of three sources, and every consumer needs to get from the union back
 * to one member — to index `STRETCH_NOTES`, to call `toneMapFloor`, to pick a node factory. Written
 * as `id as StretchId` that is an assertion the compiler cannot check, and it would keep compiling
 * if an id ever moved from one family to the other. Written as predicates it is checked at every
 * call site from ONE runtime test, and the test is the same Set that defines the family.
 */
export function isStretchId(id: TransferId): id is StretchId {
  return STRETCH_SET.has(id);
}

export function isToneMapId(id: TransferId): id is ToneMapId {
  return TONE_MAP_SET.has(id);
}

/** Which family an id belongs to, derived from the source lists rather than re-listed. */
export function transferFamily(id: TransferId): TransferFamily {
  return isToneMapId(id) ? "photographic" : "astronomical";
}

/**
 * The registry.
 *
 * Built by mapping over `TRANSFER_IDS`, so it cannot be missing an entry — a new stretch or a
 * new tone mapper joins the list, the label, the note and the UI in one step. The alternative,
 * a hand-written object literal, is the shape that left eighteen of thirty-one pages out of the
 * search index.
 */
export const TRANSFERS: ReadonlyArray<TransferRecord> = TRANSFER_IDS.map((id) => {
  const family = transferFamily(id);
  return {
    id,
    label: TRANSFER_LABELS[id],
    family,
    encoding: family === "photographic" ? "scene-linear" : "display-referred",
    huePreserving: id === "lupton",
    note: isStretchId(id)
      ? STRETCH_NOTES[id]
      : isToneMapId(id)
        ? TONE_MAP_NOTES[id]
        : "Compresses the INTENSITY and scales all three channels by that one factor, so hue is a property of the flux ratios and survives both the stretch and the clip. The only transfer here for which that is exactly true.",
  };
});

/** Look one up by id. */
export function getTransfer(id: TransferId): TransferRecord {
  const found = TRANSFERS.find((t) => t.id === id);
  if (found === undefined) throw new Error(`unknown transfer: ${id}`);
  return found;
}

/**
 * The DISPLAY value a neutral scene intensity produces under a transfer.
 *
 * The scalar, CPU-side companion to `viz/starfield/transferNode`: same curves, same white point,
 * one channel. It exists so a readout can ask "what will this actually look like?" of the
 * transfer that is genuinely being applied, rather than of a different curve that happens to be
 * nearby in the code.
 *
 * WHY THAT MATTERED. The lab's status line counted stars through `asinhResponse` — the per-star
 * curve population mode uses — and reported the result whatever transfer was selected. In
 * photometric mode that is not the applied curve, so the number moved OPPOSITE to the image:
 * going from 8 to 14 magnitudes of depth it rose from 11.7% to 66.8% while the count of stars
 * standing clear of the background actually fell, 786 to 706. A readout that confident and that
 * wrong costs more than no readout.
 *
 * `whitePoint` is the intensity that maps to display white, and it must be the PIXEL white
 * (`whitePixelIntensity`) rather than the per-star normalisation — a pixel sums thousands of
 * wings, and the two differ by three orders of magnitude on this cluster. Passing the wrong one
 * is the same class of error this function exists to fix.
 */
export function transferDisplayGrey(
  id: TransferId,
  sceneValue: number,
  whitePoint: number,
  depthMag: number,
): number {
  const white = whitePoint > 0 ? whitePoint : Number.MIN_VALUE;
  const x = Math.max(0, sceneValue);
  if (id === "lupton") {
    const q = luptonQForDepth(depthMag);
    const stretch = white * luptonStretchForWhite(q);
    return Math.min(1, luptonStretchedIntensity(x, stretch, q));
  }
  if (isToneMapId(id)) return toneMapGrey(x / white, id);
  if (isStretchId(id)) return stretch(x / white, id);
  return assertNeverTransfer(id);
}

/**
 * The scene value, relative to the white point, that this transfer still renders as one 8-bit
 * display level.
 *
 * WHAT IT IS FOR: sizing a star's billboard, so it holds exactly the part of its PSF that will
 * be visible and no more. It could not be a constant, and the spread is the argument — measured
 * across the eleven transfers it spans four orders of magnitude, from sqrt's 1.5e-5 to sinh's
 * 1.3e-2. A single floor would clip the faint wings under one curve into visible square edges
 * and waste enormous quads under another.
 *
 * `depthMag` is consumed only by `lupton`, whose floor moves with Q. Every other transfer has a
 * fixed shape, so the argument is ignored — which is itself worth stating, because it is the
 * asymmetry behind the `depthMag` control meaning different things in different modes.
 *
 * The eleven fixed-shape answers are MEMOISED, which is a correctness statement as much as a
 * speed one: a photographic floor costs a hundred bisection steps, `prepare` runs on every tick
 * of a slider drag, and — more to the point — caching is only sound BECAUSE the value cannot
 * depend on `depthMag`. Lupton is excluded from the cache for exactly that reason, so the code
 * says which transfers are depth-dependent rather than a comment claiming it.
 */
const FIXED_FLOORS = new Map<TransferId, number>();

function assertNeverTransfer(id: never): never {
  throw new Error(`transfer with no floor rule: ${String(id)}`);
}

export function transferFloor(id: TransferId, depthMag: number): number {
  if (id === "lupton") {
    const q = luptonQForDepth(depthMag);
    return luptonIntensityForOutput(ONE_DISPLAY_LEVEL, luptonStretchForWhite(q), q);
  }
  const cached = FIXED_FLOORS.get(id);
  if (cached !== undefined) return cached;
  const floor = isToneMapId(id)
    ? toneMapFloor(id)
    : isStretchId(id)
      ? stretchInverse(ONE_DISPLAY_LEVEL, id)
      : // Unreachable: `lupton` returned above and the union has no fourth member. Kept as an
        // exhaustiveness check rather than a cast, so adding a family fails the type check here.
        assertNeverTransfer(id);
  FIXED_FLOORS.set(id, floor);
  return floor;
}
