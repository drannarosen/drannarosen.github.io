/*
 * luptonNode.ts — the TSL mirror of `core/imaging/lupton` (Layer 2).
 *
 * The second and last place the display transfer is written. `luptonRGB` in Layer 0 is the
 * tested, astropy-validated original; this restates it for the GPU because a TSL graph cannot
 * call a JavaScript function. Exactly the same arrangement as `starGraph`'s mirror of
 * `starProfile`, and it carries the same obligation: change one and you must change the other,
 * with the CPU-versus-GPU parity check as the thing that fails loudly if you don't.
 *
 * The mirror is kept as small as it can be. Everything constant per frame — Q, the stretch,
 * the slope — is computed on the CPU in Layer 0 and arrives as a uniform, so what is restated
 * here is only the arithmetic that genuinely varies per pixel. In particular `slope` is passed
 * in rather than recomputed, because `frac / asinh(frac * Q)` written in both places would be
 * two chances to disagree about a number that never changes within a frame.
 *
 * WHY IT IS NOT FOLLOWED BY AN sRGB TRANSFER. Lupton's asinh stretch IS the display transfer:
 * its output is display-referred, which is why astropy writes `make_lupton_rgb`'s result
 * straight to a PNG. Applying an OETF on top would encode twice and wash the image out. So
 * `renderOutput()` is deliberately NOT called on this node, and the parity check against the
 * CPU reference is what proves no extra transform is being applied — this is precisely the
 * class of mistake that produces a plausible image.
 */
import { float, vec3, asinh, uniform } from "three/tsl";
import { Vector3, type Node } from "three/webgpu";
import { NEUTRAL_SKY, type SkyWeights } from "./calibrate.ts";
import { ASINH_A, SINH_A, type StretchId } from "../../core/imaging/stretch.ts";
import {
  LUPTON_Q,
  luptonSlope,
  luptonQForDepth,
  luptonStretchForWhite,
} from "../../core/imaging/lupton.ts";

/*
 * A vec3-valued TSL node.
 *
 * `Node<"vec3">` is what three's own inferred types resolve a node to, and it is the only
 * nameable form: TSL's types come from JSDoc, so a concrete expression's type is something like
 * `VarNode<"vec3", JoinNode<"vec3">>`, and `ShaderNodeObject` is not on the public surface.
 * Annotating with the base form keeps this file decoupled from shapes three is free to change,
 * without giving up the checking that catches a swizzle typo.
 */
type Vec3Node = Node<"vec3">;

/**
 * Smallest intensity treated as non-zero, guarding the `f(I)/I` divide.
 *
 * Not a threshold and not a tuning knob: `f(0)` is exactly `asinh(0) * slope = 0`, so
 * `f(I) / max(I, eps)` gives `0 / eps = 0` at I = 0 and is EXACT for every I above eps. It only
 * has to be small enough never to clamp a real intensity — the faintest a display can show is
 * 1/255 of white, twenty-odd orders of magnitude above this.
 */
const INTENSITY_EPSILON = 1e-30;

/**
 * Map accumulated linear band radiance to display RGB, preserving hue.
 *
 *     I     = (r + g + b) / 3
 *     f(I)  = asinh(I * Q / stretch) * slope
 *     rgb  *= f(I) / I                     <- COMMON MODE: this is what preserves hue
 *     if max(rgb) > 1: rgb /= max(rgb)     <- also common mode
 *
 * Both scalings apply to all three channels at once, which is the entire point of the
 * algorithm: hue is a property of the flux ratios and survives both the stretch and the clip.
 * Stretch the channels independently and a bright star drifts to white, which is what the
 * pipeline this replaces did.
 *
 * BRANCH-FREE, BY TWO EXACT IDENTITIES rather than by approximating the conditionals. Layer 0
 * writes both branches out because in JavaScript that reads more clearly; here each collapses
 * to arithmetic that is not merely close but equal, which also makes the mirror checkable by
 * reading rather than only by measurement:
 *
 *   - `I <= 0 ? 0 : f(I)/I`  becomes  `f(I) / max(I, eps)`, because f(0) = 0 exactly.
 *   - `peak > 1 ? rgb/peak : rgb`  becomes  `rgb / max(peak, 1)`, since dividing by 1 is the
 *     identity and the branch only ever fires above 1.
 *
 * The alternative — TSL's `select` — would evaluate both sides anyway on a GPU, so this is not
 * a performance argument. It is that two identities are easier to verify than two branches.
 */
export function createLuptonNode(radiance: Vec3Node) {
  /*
   * SKY LEVEL — subtracted before anything else, which is what `minimum` in astropy's
   * `make_lupton_rgb` is for and what a real reduction pipeline does first.
   *
   * It matters more than it sounds. The background here is the summed wings of ten thousand stars,
   * so it is genuinely present and genuinely blue (the light is dominated by hot stars), and any
   * curve that lifts the faint end lifts it too: at a log stretch a background of 3e-3 arrives at
   * 0.35. Subtracting the median first took the frame from 0.7% black to 41% black, raised the hue
   * spread from 0.225 to 0.349, and cut the blue fraction from 0.249 to 0.148.
   *
   * THE LEVEL IS NOT DERIVED; THE COLOUR IS. That split is the point. How MUCH to subtract is a
   * percentile of the rendered pixels and is not a stable fraction of anything computable without
   * them — measured across composites, frame sizes, fields of view and exposures it spans 97x,
   * against 1.45x for the white point — so it defaults to ZERO and is a control. But how that
   * amount is DISTRIBUTED across the three channels is a property of the background itself, which
   * `skyChannelWeights` computes exactly from the same profile integral the exposure already
   * trusts.
   *
   * This uniform is a vec3 for that reason, and it used to be a scalar. Subtracting one number
   * from three unequal channels changes their RATIOS, so it was silently a colour operation: it
   * under-removed the blue the background has and over-removed red it never had. Measured at a
   * 6.43%-of-white subtraction on the shipped population, 100% of blue stars survived against
   * 3.3% of red ones, and every survivor came out more saturated. The frame went uniformly blue
   * by arithmetic rather than by astronomy.
   */
  /*
   * The uniforms are created HERE, beside the arithmetic that consumes them, and handed back to
   * the caller to drive. An earlier shape took them as a parameter, which meant a caller could
   * pass a Q to one place and a slope derived from a different Q to another — and the two are
   * only consistent if `slope === frac / asinh(frac * Q)`. Creating them together makes that
   * impossible to get wrong, and `setDepth` below is the only way to move either.
   */
  const uStretch = uniform(1);
  const uQ = uniform(LUPTON_Q);
  const uSlope = uniform(luptonSlope(LUPTON_Q));
  const uSky = uniform(new Vector3(0, 0, 0));

  // Subtract the sky, then clamp up: a per-channel minimum can push one channel negative while the
  // mean intensity stays positive, which is the same order astropy uses.
  const c = vec3(radiance).sub(uSky).max(float(0));
  const intensity = c.x.add(c.y).add(c.z).div(float(3));
  const stretched = asinh(intensity.mul(uQ).div(uStretch)).mul(uSlope);
  const scale = stretched.div(intensity.max(float(INTENSITY_EPSILON)));
  const scaled = c.mul(scale).max(float(0));
  const peak = scaled.x.max(scaled.y).max(scaled.z);
  const node = scaled.div(peak.max(float(1)));

  return {
    node,
    /**
     * Set the white point — the pixel intensity that maps to display white, from
     * `whitePixelIntensity`. Cheap: it reaches the GPU next frame without rebuilding the graph.
     */
    setWhitePoint(whitePixel: number): void {
      uStretch.value = Math.max(Number.MIN_VALUE, whitePixel) * luptonStretchForWhite(uQ.value);
    },
    /**
     * Set the depth in magnitudes, which is the physical control; Q and its slope follow.
     *
     * Both are updated together because `slope` is a function of Q, and the stretch is then
     * recomputed because it is scaled by `luptonStretchForWhite(Q)` — three values, one input,
     * so nothing outside this function ever names Q.
     */
    setDepth(depthMag: number, whitePixel: number): void {
      uQ.value = luptonQForDepth(depthMag);
      uSlope.value = luptonSlope(uQ.value);
      uStretch.value = Math.max(Number.MIN_VALUE, whitePixel) * luptonStretchForWhite(uQ.value);
    },
    /**
     * Sky to subtract, as a FRACTION of the white point, distributed by the background's colour.
     *
     * `weights` are unit-mean (see `skyChannelWeights`), so `fraction` still means the same total
     * amount of light and a grey background reduces this to exactly the scalar subtraction it
     * replaced. What changes is images whose background has a colour — which, in a young cluster,
     * is all of them.
     */
    setSky(fraction: number, whitePixel: number, weights: SkyWeights = NEUTRAL_SKY): void {
      const level = Math.max(0, fraction) * Math.max(Number.MIN_VALUE, whitePixel);
      uSky.value.set(level * weights[0], level * weights[1], level * weights[2]);
    },
  };
}

/**
 * A SCALAR stretch applied per channel — the TSL mirror of `core/imaging/stretch`.
 *
 * The alternative to `createLuptonNode`, and the difference is not cosmetic. Lupton computes one
 * intensity from all three channels and scales them in COMMON MODE, which is what preserves hue.
 * These curves are applied to each channel independently, which does not: a bright star drifts
 * toward white as its channels clip at different inputs. That is a real cost and it is why
 * photometric mode uses Lupton.
 *
 * It exists because population mode's amplitude is ALREADY compressed per star — hue times an asinh
 * signal — so a second hue-preserving compression on top would compress twice, the exact fault this
 * pipeline was restructured to remove. Population mode wants `linear` here, which is the identity,
 * leaving the per-star curve as the only transfer. The other four are for comparison: seeing what
 * log does to a cluster is the answer to why nobody uses it.
 *
 * `whitePoint` divides before the curve because astropy's stretches are defined on [0, 1] with the
 * interval applied separately, and keeping that split is what lets one exposure be compared across
 * five curves.
 */
export function createStretchNode(radiance: Vec3Node, id: StretchId) {
  const uWhite = uniform(1);
  const uSky = uniform(new Vector3(0, 0, 0));
  // Sky first, then normalise — the same order as the Lupton path and as a real reduction.
  const x = vec3(radiance).sub(uSky).max(float(0)).div(uWhite).clamp(0, 1);

  const curve = (() => {
    switch (id) {
      case "linear":
        return x;
      case "sqrt":
        return x.sqrt();
      case "asinh":
        return asinh(x.div(float(ASINH_A))).div(float(Math.asinh(1 / ASINH_A)));
      case "log":
        // astropy's LogStretch(a=1000): log(a x + 1) / log(a + 1), finite at x = 0.
        return x.mul(float(1000)).add(float(1)).log().div(float(Math.log(1001)));
      case "sinh":
        return x.div(float(SINH_A)).sinh().div(float(Math.sinh(1 / SINH_A)));
    }
  })();

  return {
    node: curve,
    /** The radiance that maps to display white. Same role as Lupton's `stretch`. */
    setWhitePoint(whitePoint: number): void {
      uWhite.value = Math.max(Number.MIN_VALUE, whitePoint);
    },
    /** No-op on depth, so a caller can drive either node through the same shape. */
    setDepth(_depthMag: number, whitePoint: number): void {
      uWhite.value = Math.max(Number.MIN_VALUE, whitePoint);
    },
    /** Sky to subtract, per band — see `createLuptonNode`'s `setSky`. */
    setSky(fraction: number, whitePoint: number, weights: SkyWeights = NEUTRAL_SKY): void {
      const level = Math.max(0, fraction) * Math.max(Number.MIN_VALUE, whitePoint);
      uSky.value.set(level * weights[0], level * weights[1], level * weights[2]);
    },
  };
}
