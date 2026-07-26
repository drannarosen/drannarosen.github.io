/*
 * The volume's ray march and the star pass's projection must be exact inverses.
 *
 * ── WHAT THIS IS ACTUALLY TESTING ──
 *
 * Not `projectToUv` against itself. The whole risk in `viz/webgl` is that two shaders describe one
 * camera in two different formulations — the volume inverse-transforms the RAY, the star pass
 * forward-projects the POINT — and nothing checked that they agree. Extracting the constants to
 * `camera.ts` removes the chance of the NUMBERS drifting; it does nothing about the FORMULATIONS
 * drifting, which is the subtler half.
 *
 * So the reference here is an independent numerical inversion of the ray march: cast the volume's
 * ray for a candidate uv, walk it to the point's depth, and see where it lands. If the closed form
 * in `projectToUv` and the ray parameterisation ever stop describing the same camera, these
 * disagree — in node, with no GPU and no browser.
 *
 * The failure this guards against is not a crash. It is stars sitting slightly off their gas,
 * which on a figure about where massive stars sit is a wrong scientific claim rendered
 * convincingly.
 */
import { describe, expect, it } from "vitest";
import { VOLUME_CAMERA, glslFloat, projectToUv, type CameraView } from "./camera.ts";

/**
 * Where the VOLUME's ray for screen-uv `(u,v)` is, at the depth where it reaches `p`.
 *
 * A direct transcription of `VOLUME_FS`'s own parameterisation — `ro`, `rd`, and the model-space
 * rotation — deliberately written from the shader rather than from `camera.ts`, so it is a second
 * opinion and not a paraphrase.
 */
function rayHitsAt(
  u: number,
  v: number,
  view: CameraView,
  targetZview: number,
): { x: number; y: number } {
  const { eyeZ, focal, fovScale } = VOLUME_CAMERA;
  // rd before normalisation; normalising scales t but not the ratio, so it cancels.
  const dx = u * fovScale * view.zoom;
  const dy = v * fovScale * view.zoom;
  const dz = -focal;
  // Walk from ro = (0,0,eyeZ) until z reaches the point's view-space depth.
  const t = (targetZview - eyeZ) / dz;
  return { x: dx * t, y: dy * t };
}

/** Model-space point → view space, matching the shaders' `rotX(-pitch) * rotY(-yaw)`. */
function viewSpace(p: readonly [number, number, number], yaw: number, pitch: number) {
  const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
  const cx = Math.cos(-pitch), sx = Math.sin(-pitch);
  const x1 = cy * p[0] + sy * p[2];
  const y1 = p[1];
  const z1 = -sy * p[0] + cy * p[2];
  return { x: x1, y: cx * y1 - sx * z1, z: sx * y1 + cx * z1 };
}

describe("the star projection inverts the volume's ray march", () => {
  const VIEWS: CameraView[] = [
    { yaw: 0, pitch: 0, zoom: 1 },
    { yaw: 0.6, pitch: 0, zoom: 1 }, // the engine's DEFAULT_YAW
    { yaw: 0.6, pitch: 0.35, zoom: 1 },
    { yaw: -1.2, pitch: -0.4, zoom: 0.35 }, // ZOOM_MIN
    { yaw: 2.7, pitch: 0.9, zoom: 4.0 }, // ZOOM_MAX
  ];
  const POINTS: Array<[number, number, number]> = [
    [0, 0, 0],
    [0.3, -0.2, 0.1],
    [-0.45, 0.45, -0.45],
    [0.5, 0, 0.4],
    [0.02, 0.48, -0.12],
  ];

  it("a point projected to uv, ray-marched back, lands on the point", () => {
    let worst = 0;
    for (const view of VIEWS) {
      for (const p of POINTS) {
        const uv = projectToUv(p, view);
        expect(uv, `no projection for ${JSON.stringify(p)} at ${JSON.stringify(view)}`).not.toBeNull();
        const vs = viewSpace(p, view.yaw, view.pitch);
        const back = rayHitsAt(uv!.u, uv!.v, view, vs.z);
        worst = Math.max(worst, Math.abs(back.x - vs.x), Math.abs(back.y - vs.y));
      }
    }
    /* Pure float arithmetic on both sides, so this is rounding only — not a tolerance for
     * disagreement. A formulation drift would move it by orders of magnitude, not ulps. */
    expect(worst).toBeLessThan(1e-12);
  });

  it("refuses a point at or behind the eye rather than returning a plausible number", () => {
    /* The shaders divide by `denom` unguarded, so this is a check the GPU does not make. A point
     * at the eye plane projects to infinity; returning null makes a caller handle it. */
    expect(projectToUv([0, 0, VOLUME_CAMERA.eyeZ], { yaw: 0, pitch: 0, zoom: 1 })).toBeNull();
    expect(projectToUv([0, 0, VOLUME_CAMERA.eyeZ + 1], { yaw: 0, pitch: 0, zoom: 1 })).toBeNull();
  });

  it("zoom scales the projection inversely, and nothing else", () => {
    /* `uZoom > 1` means the cube gets smaller — more frame around it. Both shaders divide by it,
     * so doubling the zoom must halve the screen offset exactly. */
    const p: [number, number, number] = [0.3, -0.2, 0.1];
    const a = projectToUv(p, { yaw: 0.6, pitch: 0.2, zoom: 1 })!;
    const b = projectToUv(p, { yaw: 0.6, pitch: 0.2, zoom: 2 })!;
    expect(b.u).toBeCloseTo(a.u / 2, 15);
    expect(b.v).toBeCloseTo(a.v / 2, 15);
  });

  it("the cluster centre sits at the middle of the frame at any orientation", () => {
    /* The origin is on the view axis, so it must project to (0,0) whatever the rotation — a
     * cheap sanity check that the rotation is applied to the point and not to the offset. */
    for (const view of VIEWS) {
      const uv = projectToUv([0, 0, 0], view)!;
      expect(Math.hypot(uv.u, uv.v)).toBeLessThan(1e-15);
    }
  });
});

describe("glslFloat", () => {
  it("keeps today's constants exactly as the shaders already spell them", () => {
    /* Byte-identity of the generated GLSL depends on this, and shaders-baseline.test.ts asserts
     * the result. This states the requirement at its source. */
    expect(glslFloat(VOLUME_CAMERA.eyeZ)).toBe("1.7");
    expect(glslFloat(VOLUME_CAMERA.focal)).toBe("1.6");
    expect(glslFloat(VOLUME_CAMERA.fovScale)).toBe("1.15");
  });

  it("gives a round number a decimal point — the blank-canvas trap", () => {
    /* `${1.0}` is "1", and GLSL ES 3.0 will not implicitly convert that int inside
     * `uv * 1 * uZoom`. The shader fails to compile and engine.ts falls back to noopEngine, so
     * the symptom is an empty canvas with the real error only in the console. */
    expect(glslFloat(1)).toBe("1.0");
    expect(glslFloat(2)).toBe("2.0");
    expect(glslFloat(0)).toBe("0.0");
    expect(glslFloat(-3)).toBe("-3.0");
  });

  it("refuses a non-finite value instead of emitting NaN into a shader", () => {
    expect(() => glslFloat(Number.NaN)).toThrow();
    expect(() => glslFloat(Number.POSITIVE_INFINITY)).toThrow();
  });
});
