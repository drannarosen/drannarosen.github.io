/*
 * viz/hrDiagram.ts — draw the Hertzsprung–Russell diagram (Layer 2). Dumb: it
 * consumes an HRModel (log Teff / log L points, already colour/size-resolved)
 * and paints axes, gridlines and points. Teff runs hot-on-the-left, the
 * astronomer's convention.
 */
import type { HRModel } from "../state/render.ts";
import { rgb } from "./lifecycle.ts";

export interface HRColors {
  axis: string;
  grid: string;
  text: string;
}

export interface HROpts {
  selectedId?: number | null; // pinned (persistent)
  hoverId?: number | null; // transient preview
  colors?: Partial<HRColors>;
}

const MARGIN = { top: 14, right: 14, bottom: 34, left: 44 };
const TEFF_TICKS = [40000, 20000, 10000, 5000, 3000];
const log10 = Math.log10;

const DEFAULTS: HRColors = {
  axis: "rgba(230,232,238,0.5)",
  grid: "rgba(230,232,238,0.10)",
  text: "rgba(230,232,238,0.65)",
};

interface Frame {
  x(logTeff: number): number;
  y(logL: number): number;
  plotW: number;
  plotH: number;
}

function frame(model: HRModel, w: number, h: number): Frame {
  const [tLo, tHi] = model.teffRange.map(log10) as [number, number];
  const [lLo, lHi] = model.logLRange;
  const plotW = w - MARGIN.left - MARGIN.right;
  const plotH = h - MARGIN.top - MARGIN.bottom;
  return {
    plotW,
    plotH,
    // Teff reversed: hot (high logTeff) on the left.
    x: (logTeff) => MARGIN.left + (1 - (logTeff - tLo) / (tHi - tLo)) * plotW,
    y: (logL) => MARGIN.top + (1 - (logL - lLo) / (lHi - lLo)) * plotH,
  };
}

export function renderHR(
  ctx: CanvasRenderingContext2D,
  model: HRModel,
  w: number,
  h: number,
  opts: HROpts = {},
): void {
  const c = { ...DEFAULTS, ...opts.colors };
  const f = frame(model, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";

  // Teff gridlines + labels (x).
  ctx.textAlign = "center";
  for (const t of TEFF_TICKS) {
    const x = f.x(log10(t));
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, MARGIN.top);
    ctx.lineTo(x, MARGIN.top + f.plotH);
    ctx.stroke();
    ctx.fillStyle = c.text;
    ctx.fillText(t >= 1000 ? `${t / 1000}k` : `${t}`, x, h - MARGIN.bottom + 14);
  }

  // log L gridlines + labels (y).
  ctx.textAlign = "right";
  const [lLo, lHi] = model.logLRange;
  for (let n = Math.ceil(lLo); n <= Math.floor(lHi); n++) {
    const y = f.y(n);
    ctx.strokeStyle = c.grid;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, y);
    ctx.lineTo(MARGIN.left + f.plotW, y);
    ctx.stroke();
    ctx.fillStyle = c.text;
    ctx.fillText(`${n}`, MARGIN.left - 6, y); // plain log₁₀ L decades; unit in the HTML caption
  }

  // Axis frame.
  ctx.strokeStyle = c.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN.left, MARGIN.top, f.plotW, f.plotH);

  // Points.
  for (const p of model.points) {
    ctx.fillStyle = rgb(p.color, 0.9);
    ctx.beginPath();
    ctx.arc(f.x(p.logTeff), f.y(p.logL), p.sizePx, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hover preview (faint) then pinned selection (solid), so pinned wins.
  const ring = (id: number | null | undefined, style: string, width: number) => {
    if (id == null) return;
    const p = model.points.find((q) => q.id === id);
    if (!p) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(f.x(p.logTeff), f.y(p.logL), Math.max(p.sizePx + 4, 7), 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(opts.hoverId, "rgba(255,255,255,0.4)", 1);
  ring(opts.selectedId, "rgba(255,255,255,0.95)", 1.5);
}

/** Nearest HR point to a canvas coordinate, or null. */
export function pickHRPoint(
  model: HRModel,
  mx: number,
  my: number,
  w: number,
  h: number,
): number | null {
  const f = frame(model, w, h);
  let best: number | null = null;
  let bestD = 14 * 14;
  for (const p of model.points) {
    const d = (f.x(p.logTeff) - mx) ** 2 + (f.y(p.logL) - my) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}
