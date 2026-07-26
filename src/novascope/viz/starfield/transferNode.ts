/*
 * transferNode.ts — one factory for every display convention (Layer 2).
 *
 * WHAT THIS REPLACES. Choosing a display transfer used to happen in two unrelated ways. The
 * astronomical curves were TSL output nodes built in `./luptonNode`; three's tone mappers were
 * applied by setting `renderer.toneMapping` and calling `.renderOutput()` on the pipeline. Two
 * mechanisms behind one question, which is why a control could only ever offer half the answer
 * — and why AgX survived the switch to Lupton only as a comment.
 *
 * THERE IS NO SECOND MECHANISM. Three exports `agxToneMapping`, `neutralToneMapping`,
 * `acesFilmicToneMapping`, `reinhardToneMapping`, `cineonToneMapping` and `linearToneMapping`
 * from `three/tsl` as ordinary TSL functions of `(vec3 color, float exposure)`.
 * `renderer.toneMapping` + `renderOutput()` is a convenience wrapper that calls one of them and
 * then applies the output colour transform — `RenderOutputNode.setup` is four lines and does
 * exactly that. So this file calls them directly, `renderer.toneMapping` stays `NoToneMapping`,
 * and every transfer is a node built the same way and swapped the same way.
 *
 * ── THE ONE THING THAT ACTUALLY DIFFERS, AND IS NOT COSMETIC ──
 *
 * The two families disagree about whose job the sRGB encode is:
 *
 *   - Lupton and the astropy stretches are DISPLAY-REFERRED. Their output is the pixel value;
 *     astropy writes `make_lupton_rgb`'s result straight to a PNG. Encoding it again washes the
 *     image out, which is why `renderOutput()` was deliberately not called on the Lupton node.
 *   - Three's operators are SCENE-REFERRED. They return display-LINEAR values and the encode is
 *     still owed. Omitting it crushes the midtones and reads as an under-exposure.
 *
 * Both mistakes produce a plausible image, so neither is caught by review. `TRANSFERS[id].
 * encoding` in Layer 0 records which is which, and this file BRANCHES ON THAT RECORD rather
 * than on a hand-kept list of ids — so adding a transfer cannot forget its encode.
 *
 * Exposure is passed as 1 to every operator on purpose. The scene's exposure is already folded
 * into the radiance by `prepare`, and `whitePixelIntensity` sets the level; letting the tone
 * mapper scale as well would give exposure two homes, which is how the depth control came to
 * mean two things.
 */
import {
  float,
  vec3,
  vec4,
  uniform,
  agxToneMapping,
  neutralToneMapping,
  acesFilmicToneMapping,
  reinhardToneMapping,
  cineonToneMapping,
  linearToneMapping,
  workingToColorSpace,
} from "three/tsl";
/*
 * `SRGBColorSpace` is the string "srgb". Imported from `three` rather than `three/webgpu`, which
 * is a separate bundle — harmless precisely BECAUSE it is a plain string constant and not an
 * identity-bearing object, and the same pattern `scene.ts` already uses for `NoToneMapping`.
 */
import { SRGBColorSpace } from "three";
/*
 * `Vector3` comes from `three/webgpu`, NOT from `three` — unlike `SRGBColorSpace` above, which is
 * safe there precisely because it is a plain string. A class is identity-bearing, and the renderer
 * in play is the WebGPU bundle's, so importing the constructor from the other bundle would hand a
 * uniform a value of a type the renderer does not recognise as its own.
 */
import { Vector3, type Node } from "three/webgpu";
import { getTransfer, isToneMapId, type TransferId } from "../../core/imaging/transfers.ts";
import type { ToneMapId } from "../../core/imaging/toneMap.ts";
import { createLuptonNode, createStretchNode } from "./luptonNode.ts";
import { NEUTRAL_SKY, type SkyWeights } from "./calibrate.ts";

type Vec3Node = Node<"vec3">;

/**
 * The uniform interface every transfer presents.
 *
 * Deliberately identical across the families, so `scene.ts` never learns which mechanism it is
 * driving. `setDepth` is a no-op for the ten fixed-shape transfers — only Lupton's Q moves with
 * depth — and that asymmetry is the reason `depthMag` needs the honest label the page now gives
 * it, rather than being hidden behind a uniform interface AND an ambiguous name.
 */
export interface Transfer {
  /**
   * The vec3-valued node to hand the pipeline.
   *
   * Typed as three's base `Node`, which is the tightest form that actually holds. It cannot be
   * `Node<"vec3">`: the photographic path ends in `workingToColorSpace`, whose declared return is
   * `ColorSpaceNode`, and that is not assignable to the parameterised form. It should not be
   * `unknown` either — that was the previous shape and it documented nothing.
   *
   * The consequence is one cast, in `scene.ts`, where `vec4()` has no overload taking a base
   * `Node`. One cast at a single named seam is the honest cost of TSL deriving its types from
   * JSDoc; scattering casts through this file to avoid it would hide the same gap in six places.
   */
  node: Node;
  setDepth(depthMag: number, white: number): void;
  /**
   * Subtract the sky, as a fraction of white, DISTRIBUTED BY THE BACKGROUND'S COLOUR.
   *
   * `weights` are unit-mean, so `[1,1,1]` is exactly the scalar subtraction this replaced and the
   * total light removed does not depend on them — only where it is removed from. Optional so a
   * caller with no colour estimate still gets the old, neutral behaviour rather than a wrong one.
   */
  setSky(fraction: number, white: number, weights?: SkyWeights): void;
}

/**
 * Three's operators, keyed by this package's ids — the one place the mapping is written.
 *
 * Typed with three's OWN exported signature, `(color: Node, exposure: Node) => Node` — no cast is
 * needed and none should be added, since a cast here would silence exactly the check that catches
 * three changing an operator's shape. A total `Record<ToneMapId, ...>` means adding an operator to
 * Layer 0 fails the type check here until it is wired, rather than reaching a runtime `undefined`.
 */
type ToneMapFn = (color: Node, exposure: Node) => Node;

const TONE_MAP_FN: Record<ToneMapId, ToneMapFn> = {
  agx: agxToneMapping,
  neutral: neutralToneMapping,
  aces: acesFilmicToneMapping,
  reinhard: reinhardToneMapping,
  cineon: cineonToneMapping,
  srgb: linearToneMapping,
};

/**
 * Apply the sRGB output encode to a vec3, returning a vec3.
 *
 * ONE FUNCTION, because it is the single place TSL's JSDoc-derived typings run out, and naming
 * the gap once is better than two casts inline that read like carelessness:
 *
 *   - `vec4()` has no overload accepting the base `Node` that three's tone mappers return.
 *   - TSL swizzles (`.rgb`) are runtime proxies, so the compiler cannot see them on
 *     `ColorSpaceNode` even though it is declared `vec4`.
 *
 * The vec4 round trip is not decoration. `ColorSpaceNode`'s `setup` reads `outputNode.a`, so it
 * requires a vec4 in, and it declares `vec4` out — which is why the alpha has to be added and
 * then dropped. Alpha is 1: the canvas is opaque (`alpha: false`) and no transfer composites.
 */
function encodeSRGB(rgb: Node): Node {
  const rgba = vec4(rgb as never, 1);
  return (workingToColorSpace(rgba, SRGBColorSpace) as unknown as { rgb: Node }).rgb;
}

/**
 * A three tone mapping operator, followed by the sRGB encode it is owed.
 *
 * NOT CLAMPED TO 1 ON THE WAY IN, which is the difference from `createStretchNode` and is the
 * whole point of the family. An astropy stretch is defined on [0, 1] with the interval applied
 * first, so its input is clipped; a tone mapper's job IS the highlight compression, so clipping
 * before it would remove the very range it exists to handle and leave a hard-clipped image that
 * looks exactly like the operator failing.
 *
 * The white-point divide stays, though, because these operators are calibrated in absolute
 * terms — AgX's window runs from 2^-12.47 to 2^4.03 around a middle grey of 0.18 — so a scene
 * whose units are arbitrary band flux has to be brought onto that scale before the curve means
 * anything. Dividing by `whitePixelIntensity` is what does it, and it is the same normalisation
 * the scalar curves use — so one exposure calibration serves both families, which is what keeps a
 * transfer A/B a comparison of curves rather than of exposures.
 */
function createToneMapNode(radiance: Vec3Node, id: ToneMapId): Transfer {
  const uWhite = uniform(1);
  // A vec3, like the other two families: the sky has a colour. See `luptonNode`'s `setSky`.
  const uSky = uniform(new Vector3(0, 0, 0));
  // Sky first, then normalise — the same order as the Lupton path and as a real reduction.
  const scene = vec3(radiance).sub(uSky).max(float(0)).div(uWhite);
  const mapped = TONE_MAP_FN[id](scene, float(1));
  /*
   * THE ENCODE. `workingToColorSpace(x, SRGBColorSpace)` is exactly what `RenderOutputNode`
   * applies after tone mapping, and the pipeline's own `outputColorTransform` is false — so
   * this is the only encode in the chain and there is no double application. That it is written
   * here, next to the operator that requires it, rather than as a pipeline-level flag, is what
   * makes it impossible for a transfer to be added without one.
   *
   * IT IS A vec4 OPERATION IN BOTH DIRECTIONS, and getting that wrong is not a type quibble.
   * `ColorSpaceNode` declares `super('vec4')` unconditionally and its `setup` reads
   * `outputNode.a`, so handing it a vec3 is wrong going in and its result is wrong coming out:
   * the pipeline's `vec4(node, 1)` then had five components and three refused to compile the
   * graph — "Length of parameters exceeds maximum length of function 'vec4()'" — which took
   * every photographic transfer down while the astronomical ones carried on working.
   *
   * Alpha is 1 because the canvas is opaque (`alpha: false`); `.rgb` brings it back to the vec3
   * every transfer in this file returns. This is three's own arrangement in `RenderOutputNode`,
   * which works in vec4 from end to end for exactly this reason.
   *
   * Found by running the page, not by reading it. It type-checked, it bundled, and the node gates
   * were all green — a TSL graph is only validated when it is built.
   */
  const node = encodeSRGB(mapped);

  return {
    node,
    setDepth(_depthMag: number, whitePoint: number): void {
      uWhite.value = Math.max(Number.MIN_VALUE, whitePoint);
    },
    setSky(fraction: number, whitePoint: number, weights: SkyWeights = NEUTRAL_SKY): void {
      const level = Math.max(0, fraction) * Math.max(Number.MIN_VALUE, whitePoint);
      uSky.value.set(level * weights[0], level * weights[1], level * weights[2]);
    },
  };
}

/**
 * Build the display transfer named by `id`.
 *
 * The single entry point, and the only place in the renderer that knows the families exist.
 * Dispatch uses Layer 0's own `isToneMapId` predicate rather than a list of ids repeated here, so
 * a new curve reaches the renderer by joining the registry — and joins the correct branch, with
 * the sRGB encode its family requires, without this file being edited.
 *
 * `getTransfer` is called for its VALIDATION: it throws on an id the registry does not know,
 * rather than letting it fall through to `createStretchNode` and render a plausible image under
 * the wrong convention. The record is returned as well, and asserting the two agree costs one
 * line and catches a registry whose `family` has drifted from its id lists.
 */
export function createTransferNode(radiance: Vec3Node, id: TransferId): Transfer {
  const record = getTransfer(id);
  if (id === "lupton") return createLuptonNode(radiance);
  if (isToneMapId(id)) {
    if (record.encoding !== "scene-linear") {
      throw new Error(`${id} is photographic but recorded as ${record.encoding}`);
    }
    return createToneMapNode(radiance, id);
  }
  if (record.encoding !== "display-referred") {
    throw new Error(`${id} is astronomical but recorded as ${record.encoding}`);
  }
  return createStretchNode(radiance, id);
}
