/*
 * The shipped GLSL, frozen — byte for byte.
 *
 * ── WHY A STRING FIXTURE AND NOT A PIXEL COMPARISON ──
 *
 * `viz/webgl` renders three live /explore pages plus two lab surfaces, and the next commit
 * extracts the camera constants out of the two shaders into one TypeScript module. That is a
 * refactor of GLSL SOURCE, so the tightest possible proof that nothing changed is that the source
 * is unchanged: if the text the driver compiles is identical, the image cannot differ. No
 * screenshot, no tolerance, no rasteriser to argue with.
 *
 * It also catches the specific trap that makes this refactor risky. Interpolating a JavaScript
 * number into GLSL stringifies `1.0` as `"1"`, and GLSL ES 3.0 will not implicitly convert that
 * int inside `uv * 1 * uZoom`. The shader would fail to COMPILE, which `engine.ts` handles by
 * logging and returning `noopEngine` — a silently blank canvas, on pages that currently work.
 * A byte comparison catches it before it ever reaches a browser.
 *
 * ── WHEN THIS SHOULD FAIL ──
 *
 * Only when someone deliberately changes the shaders. Then read the diff, confirm the change is
 * wanted, and update the fixture in the SAME commit as the change — never in a separate "fix the
 * test" commit, which is how a fixture stops meaning anything.
 */
import { describe, expect, it } from "vitest";
import { FULLSCREEN_VS, VOLUME_FS, STAR_VS, STAR_FS } from "../shaders.ts";
import baseline from "./shaders-baseline.json";

describe("the shipped GLSL is unchanged", () => {
  it("fullscreen vertex shader", () => {
    expect(FULLSCREEN_VS).toBe(baseline.FULLSCREEN_VS);
  });

  it("volume raymarch fragment shader", () => {
    expect(VOLUME_FS).toBe(baseline.VOLUME_FS);
  });

  it("star vertex shader — where the camera is duplicated", () => {
    expect(STAR_VS).toBe(baseline.STAR_VS);
  });

  it("star fragment shader", () => {
    expect(STAR_FS).toBe(baseline.STAR_FS);
  });

  it("the camera constants appear in BOTH shaders, as float literals", () => {
    /*
     * The duplication this refactor is about, asserted so the failure message names the cause
     * rather than showing a sixty-line diff.
     *
     * `eyeZ`, `fovScale` and `focal` must agree across the two shaders or the gas and the stars
     * de-register — the volume inverse-transforms the RAY by these numbers while the star pass
     * forward-projects the POINT by them. Each is also checked to be a GLSL FLOAT: interpolating
     * a JavaScript number stringifies 1.0 as "1", and GLSL ES 3.0 will not implicitly convert
     * that int inside `uv * 1 * uZoom`. The shader then fails to COMPILE, which engine.ts handles
     * by returning `noopEngine` — a silently blank canvas on pages that currently work.
     */
    const floatLiteral = (v: string) => new RegExp(`(?<![\\d.])${v.replace(".", "\\.")}(?![\\d])`);
    for (const [name, src] of [["VOLUME_FS", VOLUME_FS], ["STAR_VS", STAR_VS]] as const) {
      for (const v of ["1.7", "1.15", "1.6"]) {
        expect(src, `${name} must carry the camera constant ${v} as a float`).toMatch(
          floatLiteral(v),
        );
      }
    }
  });
});
