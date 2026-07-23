/*
 * viz/lifecycle.ts — the shared canvas lifecycle (Layer 2), in the Cosmic
 * Playground starfield lineage: DPR-capped backing store, resize handling, and
 * an explicit cleanup. Renderers are dumb draw(ctx, w, h) callbacks; this owns
 * the element plumbing. On-demand redraw (no rAF loop) — the Census reacts to
 * input, it does not animate, so `prefers-reduced-motion` needs nothing here.
 *
 * All DOM access is inside functions (never at module top level), so importing
 * this on the server is safe (Extraction blueprint §3).
 */
export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export interface CanvasHandle {
  /** Redraw at the current size (call after the data changes). */
  redraw(): void;
  /** Detach observers. Idempotent. */
  destroy(): void;
}

export function mountCanvas(
  canvas: HTMLCanvasElement,
  draw: DrawFn,
  opts: { maxDPR?: number } = {},
): CanvasHandle {
  const maxDPR = opts.maxDPR ?? 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { redraw: () => {}, destroy: () => {} };

  let w = 0;
  let h = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDPR);
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  return {
    redraw: () => draw(ctx, w, h),
    destroy: () => ro.disconnect(),
  };
}

/** Linear [0,1] RGB → a CSS `rgb()` string with optional alpha. */
export function rgb(c: [number, number, number], a = 1): string {
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${to255(c[0])}, ${to255(c[1])}, ${to255(c[2])}, ${a})`;
}
