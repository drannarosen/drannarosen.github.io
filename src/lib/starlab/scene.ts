/*
 * scene.ts — Observed-mode v2 renderer (the Three.js LAB HARNESS).
 *
 * This is the disposable prototype harness for the photographic star renderer.
 * All physics→pixel MATH lives in the pure, three-free novascope module
 * (@novascope/viz/starOptics); this file is only the Three.js glue (buffers,
 * uniforms, HDR passes, controls) and its GLSL mirrors that math.
 *
 * STUB (Stage 0): the real renderer is built in Stage 4 of
 * docs/plans/2026-07-24-star-render-lab-redesign.md. For now it clears a WebGL2
 * context so the A/B switch is wired end-to-end and we confirm, early, that the
 * context and the @novascope seam both work.
 */
import { STAROPTICS_OK } from "@novascope/viz/starOptics";

export interface StarLabV2 {
  dispose(): void;
  starCount: number;
}

export async function initStarLabV2(canvas: HTMLCanvasElement): Promise<StarLabV2> {
  // Prove the seam: the harness can reach the pure novascope math.
  if (!STAROPTICS_OK) throw new Error("starOptics module not reachable through @novascope alias");

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
