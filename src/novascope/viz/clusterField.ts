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

  ctx.globalCompositeOperation = "lighter";
  for (const { s, p } of drawn) {
    const r = Math.max(0.4, s.sizePx * (cam.mode === "3D" ? p.persp : 1));
    const a = Math.min(1, s.alpha * (cam.mode === "3D" ? Math.min(1.2, p.persp) : 1));

    const glow = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 3.2);
    glow.addColorStop(0, rgb(s.color, 0.5 * a));
    glow.addColorStop(1, rgb(s.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r * 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgb(s.color, a);
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

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
