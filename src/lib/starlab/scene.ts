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

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor((canvas.clientWidth || 800) * dpr));
    const h = Math.max(1, Math.floor((canvas.clientHeight || 600) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });

  // Deep field clear — the observed-mode background is near-black, not pure black.
  gl.clearColor(0.02, 0.024, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return {
    starCount: 0,
    dispose() {
      window.removeEventListener("resize", resize);
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    },
  };
}
