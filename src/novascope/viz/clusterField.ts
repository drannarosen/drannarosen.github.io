/*
 * viz/clusterField.ts — draw the 2-D projected cluster (Layer 2). Dumb: it
 * consumes a RenderModel (already colour/size/alpha-resolved by the selector)
 * and paints glowing points. No physics here.
 */
import type { RenderModel } from "../state/render.ts";
import { rgb } from "./lifecycle.ts";

export interface ClusterFieldOpts {
  /** Highlight this star (hover/selection) with a ring. */
  selectedId?: number | null;
  /** Fraction of the min dimension used as the plot radius. */
  fit?: number;
}

export function renderClusterField(
  ctx: CanvasRenderingContext2D,
  model: RenderModel,
  w: number,
  h: number,
  opts: ClusterFieldOpts = {},
): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const scale = (Math.min(w, h) / 2) * (opts.fit ?? 0.92) / (model.maxR || 1);

  ctx.globalCompositeOperation = "lighter"; // additive glow, like a real field
  for (const s of model.stars) {
    const px = cx + s.x * scale;
    const py = cy + s.y * scale;
    const r = s.sizePx;

    // Soft glow.
    const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 3.2);
    glow.addColorStop(0, rgb(s.color, 0.5 * s.alpha));
    glow.addColorStop(1, rgb(s.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, r * 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Core.
    ctx.fillStyle = rgb(s.color, s.alpha);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // Selection ring.
  if (opts.selectedId != null) {
    const sel = model.stars.find((s) => s.id === opts.selectedId);
    if (sel) {
      const px = cx + sel.x * scale;
      const py = cy + sel.y * scale;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(sel.sizePx + 4, 7), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Nearest star to a canvas point, or null. Used for hover selection. */
export function pickStar(
  model: RenderModel,
  mx: number,
  my: number,
  w: number,
  h: number,
  opts: { fit?: number } = {},
): number | null {
  const cx = w / 2;
  const cy = h / 2;
  const scale = (Math.min(w, h) / 2) * (opts.fit ?? 0.92) / (model.maxR || 1);
  let best: number | null = null;
  let bestD = 14 * 14; // px² pick radius
  for (const s of model.stars) {
    const px = cx + s.x * scale;
    const py = cy + s.y * scale;
    const d = (px - mx) ** 2 + (py - my) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s.id;
    }
  }
  return best;
}
