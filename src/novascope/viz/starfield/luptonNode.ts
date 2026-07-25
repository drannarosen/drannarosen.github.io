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
import type { Node } from "three/webgpu";
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
   * The uniforms are created HERE, beside the arithmetic that consumes them, and handed back to
   * the caller to drive. An earlier shape took them as a parameter, which meant a caller could
   * pass a Q to one place and a slope derived from a different Q to another — and the two are
   * only consistent if `slope === frac / asinh(frac * Q)`. Creating them together makes that
   * impossible to get wrong, and `setDepth` below is the only way to move either.
   */
  const uStretch = uniform(1);
  const uQ = uniform(LUPTON_Q);
  const uSlope = uniform(luptonSlope(LUPTON_Q));

  const c = vec3(radiance);
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
  };
}
