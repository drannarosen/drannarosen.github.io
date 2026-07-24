/*
 * scene.ts — Observed-mode v2 renderer (the Three.js LAB HARNESS).
 *
 * This is the disposable prototype harness for the photographic star renderer.
 * All physics lives in the pure, three-free novascope core, filed by domain:
 * @novascope/core/photometry (apparent flux), /colorimetry (blackbody colour),
 * /optics (PSF, aureole), /imaging (white point, asinh stretch), with
 * @novascope/viz/starfield holding the pixel-space policy. This file is only the
 * Three.js glue, and its TSL graph mirrors that maths.
 *
 * STUB (Stage 0): the real renderer is built in Stage 4 of
 * docs/plans/2026-07-24-star-render-lab-redesign.md. For now it holds a WebGL2
 * context so the @novascope seam is proven end-to-end.
 */
import { D0_PC } from "@novascope/core/photometry";

export interface StarLabV2 {
  dispose(): void;
  starCount: number;
}

export async function initStarLabV2(canvas: HTMLCanvasElement): Promise<StarLabV2> {
  // Prove the seam: the harness can reach the pure novascope math.
  if (!(D0_PC > 0)) throw new Error("novascope physics not reachable through the @novascope alias");

  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 unavailable — the v2 renderer requires it");

  /*
   * Size the drawing buffer from the canvas's OWN layout box, via ResizeObserver.
   * A `window.resize` listener misses any layout change the window didn't cause
   * (a pane resize, a CSS/container change, fullscreen), which silently leaves the
   * buffer at a stale size — observed here as a 1254px buffer under a 1342 CSS px
   * stage at DPR 2, i.e. a half-resolution render. Star sizing is in PIXELS, so a
   * stale buffer would mis-size every star: this must be correct before Stage 4.
   */
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round((canvas.clientWidth || 800) * dpr));
    const h = Math.max(1, Math.round((canvas.clientHeight || 600) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // Deep field clear — the observed-mode background is near-black, not pure black.
  gl.clearColor(0.02, 0.024, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return {
    starCount: 0,
    dispose() {
      observer.disconnect();
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    },
  };
}
