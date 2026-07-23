/*
 * viz/clusterField.ts — draw the cluster (Layer 2), 2-D or 3-D via the camera.
 * Dumb: consumes a RenderModel (colour/size/alpha already resolved) and the
 * camera; paints depth-sorted, depth-cued glowing points. No physics here.
 */
import type { RenderModel } from "../state/render.ts";
import { rgb } from "./lifecycle.ts";
import { type Camera, project } from "./camera.ts";

export interface ClusterFieldOpts {
  camera: Camera;
  selectedId?: number | null; // pinned (persistent)
  hoverId?: number | null; // transient preview
  scaleBar?: boolean; // physical scale bar (default on)
}

export function renderClusterField(
  ctx: CanvasRenderingContext2D,
  model: RenderModel,
  w: number,
  h: number,
  opts: ClusterFieldOpts,
): void {
  ctx.clearRect(0, 0, w, h);
  const cam = opts.camera;

  // Project + depth-sort (far first) so nearer stars paint on top.
  const drawn = model.stars
    .map((s) => ({ s, p: project(s.x, s.y, s.z, cam, w, h, model.maxR) }))
    .sort((a, b) => a.p.depth - b.p.depth);

  // Perf: the faint many (most of an IMF-sampled cluster) get a cheap square
  // dot; only the bright few get the expensive radial-gradient glow. Plus an
  // off-screen cull. This is what keeps N ~ 10⁴ smooth under live orbit.
  const TAU = Math.PI * 2;
  const GLOW_MIN = 1.6; // px core radius above which a star earns a glow halo
  ctx.globalCompositeOperation = "lighter";
  for (const { s, p } of drawn) {
    if (p.sx < -8 || p.sx > w + 8 || p.sy < -8 || p.sy > h + 8) continue;
    const r = Math.max(0.4, s.sizePx * (cam.mode === "3D" ? p.persp : 1));
    const a = Math.min(1, s.alpha * (cam.mode === "3D" ? Math.min(1.2, p.persp) : 1));
    if (r >= GLOW_MIN) {
      const glow = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 3.2);
      glow.addColorStop(0, rgb(s.color, 0.5 * a));
      glow.addColorStop(1, rgb(s.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r * 3.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgb(s.color, a);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = rgb(s.color, a);
      ctx.fillRect(p.sx - r, p.sy - r, r * 2, r * 2);
    }
  }
  ctx.globalCompositeOperation = "source-over";

  // Physical scale bar (bottom-left). Uses the base orthographic scale — exact
  // in 2-D, approximate under 3-D perspective. Picks a "nice" length ~22% wide.
  if (opts.scaleBar !== false) {
    const pxPerPc = ((Math.min(w, h) / 2) * 0.92) / (model.maxR || 1) * cam.zoom;
    const target = Math.min(w, h) * 0.22;
    let Lpc = 0.2;
    for (const c of [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]) if (c * pxPerPc <= target) Lpc = c;
    const barPx = Lpc * pxPerPc;
    const x0 = 14;
    const y0 = h - 16;
    ctx.strokeStyle = "rgba(230,232,238,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + barPx, y0);
    ctx.moveTo(x0, y0 - 4);
    ctx.lineTo(x0, y0 + 4);
    ctx.moveTo(x0 + barPx, y0 - 4);
    ctx.lineTo(x0 + barPx, y0 + 4);
    ctx.stroke();
    ctx.fillStyle = "rgba(230,232,238,0.9)";
    ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${Lpc} pc`, x0, y0 - 6);
  }

  // Hover preview (faint) then pinned selection (solid).
  const ring = (id: number | null | undefined, style: string, width: number) => {
    if (id == null) return;
    const s = model.stars.find((q) => q.id === id);
    if (!s) return;
    const p = project(s.x, s.y, s.z, cam, w, h, model.maxR);
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, Math.max(s.sizePx + 4, 7), 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(opts.hoverId, "rgba(255,255,255,0.4)", 1);
  ring(opts.selectedId, "rgba(255,255,255,0.95)", 1.5);
}

/** Nearest star to a canvas point under the current camera, or null. */
export function pickStar(
  model: RenderModel,
  mx: number,
  my: number,
  w: number,
  h: number,
  cam: Camera,
): number | null {
  let best: number | null = null;
  let bestD = 14 * 14;
  for (const s of model.stars) {
    const p = project(s.x, s.y, s.z, cam, w, h, model.maxR);
    const d = (p.sx - mx) ** 2 + (p.sy - my) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s.id;
    }
  }
  return best;
}
