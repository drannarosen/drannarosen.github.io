/*
 * camera.ts — the volumetric engine's camera, in one place (Layer 2).
 *
 * ── THE PROBLEM THIS SOLVES ──
 *
 * `viz/webgl` draws each frame in two passes that must agree about where the camera is, and until
 * now they each carried their own copy of the numbers:
 *
 *   VOLUME_FS  inverse-transforms the RAY   — `ro = (0,0,1.7)`, `rd = (uv*1.15*zoom, -1.6)`
 *   STAR_VS    forward-projects the POINT   — `denom = 1.7 - P.z`, `clip = P*1.6/(1.15*zoom)/denom`
 *
 * Same three numbers, two shaders, two different formulations, and nothing checking that they
 * match. The comments said "same rotation as the volume" and "match the volume's zoom", which is
 * the tell: prose enforcing an invariant no gate could reach, in GLSL, where the node checks
 * cannot see. Change the field of view in one and the other does not fail — the stars simply
 * drift off their gas, which on a figure about where massive stars sit is a wrong scientific
 * claim rendered convincingly.
 *
 * This is the same shape as the bug already recorded on `DEFAULT_AUREOLE` — amplitude 0.06 in
 * `core/optics` while the shader used 0.012 — and it is why that one made "does the GPU match the
 * CPU?" unanswerable by construction.
 *
 * ── THE TWO PASSES ARE EXACT INVERSES, AND THAT IS TESTABLE ──
 *
 * They are not merely "consistent if you are careful". Given the volume's parameterisation, the
 * star projection is DERIVABLE:
 *
 *     a pixel at uv casts   rd = (uv · fovScale · zoom, −focal)   from   ro = (0, 0, eyeZ)
 *     it reaches model point P when   eyeZ − focal·t = P.z   ⇒   t = (eyeZ − P.z) / focal
 *     and                              uv · fovScale · zoom · t = P.xy
 *     ⇒   uv = P.xy · focal / (fovScale · zoom · (eyeZ − P.z))
 *
 * which is exactly what `STAR_VS` computes. `projectToUv` below implements that closed form, and
 * `camera.test.ts` checks it against an independent numerical inversion of the ray march — so the
 * relationship is asserted rather than trusted, in node, with no GPU.
 *
 * ── WHAT IS NOT HERE ──
 *
 * The rotation (`rotY(yaw)` then `rotX(pitch)`, applied inverted) is identical in both shaders as
 * plain GLSL and is left there: it has no magic numbers to drift. Only the three numbers that
 * MUST agree live here.
 */

/**
 * The camera's three numbers. Changing any of them changes the framing of every /explore page
 * that renders gas, and both shaders follow automatically.
 *
 * These are not derived from anything — they are a composition, chosen by eye so the cloud fills
 * the frame. They are constants rather than physics, and the value of gathering them is that they
 * cannot disagree with themselves, not that they are meaningful on their own.
 */
export const VOLUME_CAMERA = {
  /** Eye distance along +z, in units of the volume cube's half-width. */
  eyeZ: 1.7,
  /** Ray-direction z. Larger = narrower field of view. */
  focal: 1.6,
  /** Screen-uv scale. Multiplied by the view's zoom. */
  fovScale: 1.15,
} as const;

/**
 * A number as a GLSL float literal — with a decimal point, always.
 *
 * ── WHY THIS EXISTS ──
 *
 * `${1.0}` stringifies to `"1"`, and GLSL ES 3.0 does not implicitly convert an int inside
 * `uv * 1 * uZoom`. The shader fails to COMPILE, and `engine.ts` handles a compile failure by
 * logging and returning `noopEngine` — so the visible symptom is a blank canvas on a page that
 * worked yesterday, with the real error buried in the console.
 *
 * Every one of today's constants (1.7, 1.6, 1.15) already stringifies with a point, so this
 * changes nothing now. It exists for the edit that sets one of them to a round number, which is
 * the edit that would otherwise ship the blank canvas.
 */
export function glslFloat(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`glslFloat: ${v} is not a finite number`);
  const s = String(v);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}

/** The engine's view state, as far as the projection is concerned. */
export interface CameraView {
  yaw: number;
  pitch: number;
  /** Aspect-fitted zoom — the same value both shaders receive as `uZoom`. */
  zoom: number;
}

/**
 * Rotate a model-space point into view space: `rotX(-pitch) * rotY(-yaw) * p`, as both shaders do.
 *
 * ── GLSL `mat3` IS COLUMN-MAJOR, AND THE FIRST VERSION OF THIS FUNCTION WAS NOT ──
 *
 * The shaders build the rotations as
 *
 *     rotY(a) = mat3( c, 0., s,   0., 1., 0.,   -s, 0., c)
 *     rotX(a) = mat3(1., 0., 0.,  0., c, -s,    0., s, c)
 *
 * and those argument triples are COLUMNS, not rows. Read as rows they give the TRANSPOSE, which
 * for a rotation is its inverse — so the error is invisible at yaw = pitch = 0 and grows with
 * angle. Measured against the compiled shader before the fix: 0 px at no rotation, 13.4 px at
 * yaw 0.6, 11.3 px at pitch 0.4.
 *
 * It survived a node test that was supposed to be independent, because the reference in
 * `camera.test.ts` was written in the same sitting and reproduced the same misreading on both
 * sides. Only rendering it on a GPU and looking at where the star actually landed caught it. That
 * test now builds the matrices from explicit COLUMNS so the convention is visible rather than
 * remembered.
 */
function toViewSpace(
  p: readonly [number, number, number],
  yaw: number,
  pitch: number,
): [number, number, number] {
  const [x, y, z] = p;
  // rotY(-yaw), column-major: x' = c·x − s·z, z' = s·x + c·z
  const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
  const x1 = cy * x - sy * z;
  const y1 = y;
  const z1 = sy * x + cy * z;
  // rotX(-pitch), column-major: y' = c·y + s·z, z' = −s·y + c·z
  const cx = Math.cos(-pitch), sx = Math.sin(-pitch);
  return [x1, cx * y1 + sx * z1, -sx * y1 + cx * z1];
}

/**
 * Where a model-space point lands, in the volume shader's screen-uv coordinates.
 *
 * `p` is in units of the cube half-width (i.e. already divided by `box`), matching `STAR_VS`'s
 * `aPos / uBox`. Returns `null` when the point is at or behind the eye plane, where the projection
 * is undefined — the shaders divide by `denom` unguarded, so a caller checking this is checking
 * something the GPU does not.
 */
export function projectToUv(
  p: readonly [number, number, number],
  view: CameraView,
): { u: number; v: number; denom: number } | null {
  const { eyeZ, focal, fovScale } = VOLUME_CAMERA;
  const [x, y, z] = toViewSpace(p, view.yaw, view.pitch);
  const denom = eyeZ - z;
  if (denom <= 0) return null;
  const k = focal / (fovScale * view.zoom * denom);
  return { u: x * k, v: y * k, denom };
}
